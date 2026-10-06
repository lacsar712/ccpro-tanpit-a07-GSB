from django.db import IntegrityError, transaction
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, SignBook, Signature, User, Yard
from pits.rules import REQUIRED_SIGNERS, RuleError, assert_can_set_status, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class BookIn(Schema):
    signers: list[str]


def pit_json(pit: Pit) -> dict:
    book = next((b for b in pit.sign_books.all() if b.withdrawn_at is None), None)
    signers = []
    if book is not None:
        signers = sorted({s.signer for s in book.signatures.all() if s.withdrawn_at is None})
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "bookId": None if book is None else book.id,
        "signers": signers,
        "signerCount": len(signers),
    }


def signature_json(sig: Signature) -> dict:
    return {
        "id": sig.id,
        "signer": sig.signer,
        "signedAt": sig.signed_at.isoformat(),
        "withdrawnAt": None if sig.withdrawn_at is None else sig.withdrawn_at.isoformat(),
        "withdrawnBy": sig.withdrawn_by or None,
    }


def book_json(book: SignBook) -> dict:
    return {
        "id": book.id,
        "pitId": book.pit_id,
        "pitCode": book.pit.code,
        "createdBy": book.created_by,
        "createdAt": book.created_at.isoformat(),
        "withdrawnAt": None if book.withdrawn_at is None else book.withdrawn_at.isoformat(),
        "withdrawnBy": book.withdrawn_by or None,
        "signatures": [signature_json(s) for s in book.signatures.all()],
    }


def get_pit_or_404(pit_id: int) -> Pit:
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    return pit


def require_admin(request) -> None:
    if request.auth.role != "admin":
        raise HttpError(403, "仅管理员可执行此操作")


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
    yard = Yard.objects.prefetch_related("pits__samples", "pits__sign_books__signatures").first()
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
def list_books(request, pit_id: int | None = None):
    qs = SignBook.objects.select_related("pit").prefetch_related("signatures").order_by("-id")
    if pit_id is not None:
        qs = qs.filter(pit_id=pit_id)
    return {"books": [book_json(b) for b in qs]}


@api.post("/pits/{pit_id}/books", auth=auth)
def submit_book(request, pit_id: int, payload: BookIn):
    """主管交整本联签簿：恰好两格、两名不同人；同坑只许一本现行簿。"""
    require_admin(request)
    pit = get_pit_or_404(pit_id)
    names = [(n or "").strip() for n in payload.signers]
    if len(names) != REQUIRED_SIGNERS or not all(names):
        raise HttpError(400, f"联签簿须恰好 {REQUIRED_SIGNERS} 格签字人")
    if len(set(names)) != len(names):
        raise HttpError(400, "两格签字人同名，须为不同人")
    try:
        with transaction.atomic():
            if SignBook.objects.filter(pit=pit, withdrawn_at__isnull=True).exists():
                raise HttpError(409, "该坑已有未撤回联签簿")
            book = SignBook.objects.create(pit=pit, created_by=request.auth.username)
            for name in names:
                Signature.objects.create(book=book, pit=pit, signer=name)
    except IntegrityError:
        raise HttpError(409, "该坑已有未撤回联签簿")
    return book_json(book)


@api.post("/pits/{pit_id}/sign", auth=auth)
def sign_pit(request, pit_id: int):
    """操作工给自己签字：无现行簿则开簿；同坑未撤回签字按人去重；双格签满即止。"""
    pit = get_pit_or_404(pit_id)
    username = request.auth.username
    for _ in range(3):
        try:
            with transaction.atomic():
                book = SignBook.objects.select_for_update().filter(pit=pit, withdrawn_at__isnull=True).first()
                if book is None:
                    book = SignBook.objects.create(pit=pit, created_by=username)
                active = book.signatures.filter(withdrawn_at__isnull=True)
                if active.filter(signer=username).exists():
                    raise HttpError(409, "您已在本坑联签簿签过字")
                if active.count() >= REQUIRED_SIGNERS:
                    raise HttpError(400, f"联签簿双格已签满 {REQUIRED_SIGNERS} 人")
                Signature.objects.create(book=book, pit=pit, signer=username)
                return book_json(book)
        except IntegrityError:
            continue
    raise HttpError(409, "联签冲突，请重试")


@api.post("/signatures/{signature_id}/withdraw", auth=auth)
def withdraw_signature(request, signature_id: int):
    require_admin(request)
    sig = Signature.objects.filter(id=signature_id).first()
    if sig is None:
        raise HttpError(404, "签字不存在")
    if sig.withdrawn_at is None:
        sig.withdrawn_at = timezone.now()
        sig.withdrawn_by = request.auth.username
        sig.save(update_fields=["withdrawn_at", "withdrawn_by"])
    return book_json(sig.book)


@api.post("/books/{book_id}/withdraw", auth=auth)
def withdraw_book(request, book_id: int):
    require_admin(request)
    book = SignBook.objects.filter(id=book_id).first()
    if book is None:
        raise HttpError(404, "联签簿不存在")
    if book.withdrawn_at is None:
        with transaction.atomic():
            now = timezone.now()
            book.signatures.filter(withdrawn_at__isnull=True).update(
                withdrawn_at=now, withdrawn_by=request.auth.username
            )
            book.withdrawn_at = now
            book.withdrawn_by = request.auth.username
            book.save(update_fields=["withdrawn_at", "withdrawn_by"])
    return book_json(book)
