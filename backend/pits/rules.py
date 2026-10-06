"""鞣坑放液门槛：最近一次浸液酸碱度须在 3.5～5.0，且现行联签簿须有两名不同人的未撤回签字。"""

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
    """坑的现行（未撤回）联签簿，没有则 None。"""
    return pit.sign_books.filter(withdrawn_at__isnull=True).first()


def active_signers(pit: Pit) -> list[str]:
    """现行联签簿里未撤回签字的签字人，按人去重后排序。"""
    book = active_book(pit)
    if book is None:
        return []
    names = book.signatures.filter(withdrawn_at__isnull=True).values_list("signer", flat=True)
    return sorted(set(names))


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
    signers = active_signers(pit)
    if len(signers) < REQUIRED_SIGNERS:
        raise RuleError(f"联签须 {REQUIRED_SIGNERS} 名不同人，当前未撤回签字 {len(signers)} 人，不能放液")
