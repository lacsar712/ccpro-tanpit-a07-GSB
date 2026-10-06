"""鞣坑放液门槛：最近一次浸液酸碱度须在 3.5～5.0，且联签簿有两名不同人的未撤回签字。"""

from django.db.models import Count

from pits.models import Pit, SignBook

MIN_PH = 3.5
MAX_PH = 5.0
REQUIRED_SIGNERS = 2


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def active_book(pit: Pit) -> SignBook | None:
    return pit.books.filter(withdrawn_at__isnull=True).order_by("-id").first()


def active_signer_count(pit: Pit) -> int:
    """现行联签簿上、未撤回签字的不同签字人数。"""
    book = active_book(pit)
    if book is None:
        return 0
    return book.signatures.filter(revoked_at__isnull=True).aggregate(
        n=Count("signer", distinct=True)
    )["n"]


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    # 登记酸碱度、改成鞣制中（含注液）都不看联签。
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
    signers = active_signer_count(pit)
    if signers < REQUIRED_SIGNERS:
        raise RuleError(f"联签簿仅有 {signers} 人未撤回签字，须两名不同人签字才能放液")
