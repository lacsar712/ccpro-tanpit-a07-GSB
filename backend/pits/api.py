import time

from django.db import IntegrityError, OperationalError, transaction
from django.utils import timezone
from ninja import NinjaAPI, Query, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, SignBook, Signature, User, Yard
from pits.rules import RuleError, active_signer_count, assert_can_set_status, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()
ACTIVE_SLOTS = 2


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class BookFilter(Schema):
    pit_id: int | None = None


def iso(dt) -> str | None:
    return None if dt is None else dt.isoformat()


def require_admin(user: User) -> None:
    if user.role != "admin":
        raise HttpError(403, "只有管理员可以撤回")


def signature_json(sig: Signature) -> dict:
    return {
        "id": sig.id,
        "signer": sig.signer,
        "signedAt": iso(sig.signed_at),
        "revokedBy": sig.revoked_by or None,
        "revokedAt": iso(sig.revoked_at),
    }


def book_json(book: SignBook) -> dict:
    signatures = sorted(book.signatures.all(), key=lambda s: (s.signed_at, s.id))
    active = [s for s in signatures if s.is_active]
    return {
        "id": book.id,
        "pitId": book.pit_id,
        "openedBy": book.opened_by,
        "openedAt": iso(book.opened_at),
        "withdrawnBy": book.closed_by or None,
        "withdrawnAt": iso(book.withdrawn_at),
        "active": book.is_active,
        "activeSignerCount": len({s.signer for s in active}),
        "slots": ACTIVE_SLOTS,
        "signatures": [signature_json(s) for s in signatures],
    }


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "activeSigners": active_signer_count(pit),
    }


def get_pit_or_404(pit_id: int) -> Pit:
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    return pit


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related(
        "pits__samples", "pits__books__signatures"
    ).first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = get_pit_or_404(pit_id)
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    pit = get_pit_or_404(pit_id)
    try:
        assert_can_set_status(pit, payload.status)
    except RuleError as exc:
        raise HttpError(400, str(exc))
    pit.status = payload.status
    pit.save(update_fields=["status"])
    return pit_json(pit)


@api.get("/books", auth=auth)
def list_books(request, filters: BookFilter = Query(...)):
    """联签簿列表，可按坑筛选；含每本簿的全部签字与撤回痕迹。"""
    qs = SignBook.objects.prefetch_related("signatures", "pit")
    if filters.pit_id is not None:
        qs = qs.filter(pit_id=filters.pit_id)
    books = qs.order_by("-id")
    return {"books": [book_json(b) for b in books]}


@api.post("/pits/{pit_id}/books", auth=auth)
def open_book(request, pit_id: int):
    """开立现行联签簿。同一坑只许一本现行簿：行锁串行，部分唯一索引兜底。"""
    pit = get_pit_or_404(pit_id)
    username = request.auth.username
    try:
        with transaction.atomic():
            existing = (
                SignBook.objects.select_for_update()
                .filter(pit=pit, withdrawn_at__isnull=True)
                .first()
            )
            if existing is not None:
                raise HttpError(409, "该坑已有一本未撤回联签簿")
            book = SignBook.objects.create(pit=pit, opened_by=username)
    except IntegrityError:
        # 并发开立：部分唯一索引 uniq_active_book_per_pit 只许一本存活（PG 唯一冲突）。
        raise HttpError(409, "该坑已有一本未撤回联签簿")
    except OperationalError:
        # 抢同一坑槽位时的锁/串行化失败（PG deadlock/lock timeout，SQLite database is locked）。
        raise HttpError(409, "开立冲突，该坑可能已有未撤回联签簿，请刷新后重试")
    return book_json(book)


@api.post("/books/{book_id}/signatures", auth=auth)
def sign_book(request, book_id: int):
    """在双格联签簿上为自己签字。同一坑未撤回签字按人去重，满两人即封格。"""
    username = request.auth.username

    def attempt():
        with transaction.atomic():
            book = (
                SignBook.objects.select_for_update()
                .prefetch_related("signatures")
                .filter(id=book_id)
                .first()
            )
            if book is None:
                raise HttpError(404, "联签簿不存在")
            if not book.is_active:
                raise HttpError(409, "该联签簿已撤回，不能再签字")
            active = [s for s in book.signatures.all() if s.is_active]
            if any(s.signer == username for s in active):
                raise HttpError(409, "你在该坑已有未撤回签字")
            if len({s.signer for s in active}) >= ACTIVE_SLOTS:
                raise HttpError(409, "联签簿已满两人")
            Signature.objects.create(book=book, signer=username)

    # 并发签字时的锁/串行化冲突：重试即可读到对方已提交的签字。
    # 两名不同人重试后都能落下；同一人重试会撞去重而转 409。
    for i in range(5):
        try:
            attempt()
            break
        except IntegrityError:
            # 部分唯一索引兜底：同人未撤回签字去重。
            raise HttpError(409, "你在该坑已有未撤回签字")
        except OperationalError:
            if i == 4:
                raise HttpError(409, "签字冲突，请刷新后重试")
            time.sleep(0.02 * (i + 1))
    # 提交后重读，绕开 prefetch 缓存拿到新签字。
    fresh = SignBook.objects.prefetch_related("signatures").get(id=book_id)
    return book_json(fresh)


@api.post("/signatures/{signature_id}/revoke", auth=auth)
def revoke_signature(request, signature_id: int):
    """撤回单条签字，仅管理员。"""
    require_admin(request.auth)
    sig = Signature.objects.select_related("book").filter(id=signature_id).first()
    if sig is None:
        raise HttpError(404, "签字不存在")
    if not sig.is_active:
        raise HttpError(409, "该签字已撤回")
    if not sig.book.is_active:
        raise HttpError(409, "所在联签簿已撤回")
    sig.revoked_at = timezone.now()
    sig.revoked_by = request.auth.username
    sig.save(update_fields=["revoked_at", "revoked_by"])
    return signature_json(sig)


@api.post("/books/{book_id}/withdraw", auth=auth)
def withdraw_book(request, book_id: int):
    """撤回整本联签簿（仅管理员）；簿上未撤回签字一并作廢。"""
    require_admin(request.auth)

    def attempt():
        with transaction.atomic():
            book = (
                SignBook.objects.select_for_update()
                .prefetch_related("signatures")
                .filter(id=book_id)
                .first()
            )
            if book is None:
                raise HttpError(404, "联签簿不存在")
            if not book.is_active:
                raise HttpError(409, "该联签簿已撤回")
            now = timezone.now()
            admin = request.auth.username
            for sig in book.signatures.all():
                if sig.is_active:
                    sig.revoked_at = now
                    sig.revoked_by = admin
                    sig.save(update_fields=["revoked_at", "revoked_by"])
            book.withdrawn_at = now
            book.closed_by = admin
            book.save(update_fields=["withdrawn_at", "closed_by"])

    # 并发撤回时的锁冲突：重试后读到对方已撤回，转 409。
    for i in range(5):
        try:
            attempt()
            break
        except OperationalError:
            if i == 4:
                raise HttpError(409, "撤回冲突，请刷新后重试")
            time.sleep(0.02 * (i + 1))
    return book_json(SignBook.objects.prefetch_related("signatures").get(id=book_id))
