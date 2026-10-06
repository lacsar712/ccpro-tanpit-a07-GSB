from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.db.models import Q


class User(models.Model):
    username = models.CharField(max_length=64, unique=True)
    password_hash = models.CharField(max_length=256)
    role = models.CharField(max_length=20, default="worker")

    def set_password(self, raw: str) -> None:
        self.password_hash = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password_hash)


class Yard(models.Model):
    name = models.CharField(max_length=120)
    village = models.CharField(max_length=120, blank=True)


class Pit(models.Model):
    STATUS_FILL = "fill"
    STATUS_TANNING = "tanning"
    STATUS_DRAINED = "drained"

    yard = models.ForeignKey(Yard, on_delete=models.CASCADE, related_name="pits")
    code = models.CharField(max_length=40)
    status = models.CharField(max_length=20, default=STATUS_FILL)
    row = models.IntegerField(default=0)
    col = models.IntegerField(default=0)

    class Meta:
        unique_together = ("yard", "code")


class LiquorSample(models.Model):
    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="samples")
    taken_at = models.DateTimeField(auto_now_add=True)
    ph = models.FloatField()
    operator = models.CharField(max_length=64, blank=True)


class SignBook(models.Model):
    """联签簿：同一坑至多一本未撤回（现行）簿。"""

    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="books")
    opened_by = models.CharField(max_length=64)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_by = models.CharField(max_length=64, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pit"],
                condition=Q(withdrawn_at__isnull=True),
                name="uniq_active_book_per_pit",
            )
        ]

    @property
    def is_active(self) -> bool:
        return self.withdrawn_at is None


class Signature(models.Model):
    """双格签字：同一本簿（同一坑）内，未撤回签字按人去重。"""

    book = models.ForeignKey(SignBook, on_delete=models.CASCADE, related_name="signatures")
    signer = models.CharField(max_length=64)
    signed_at = models.DateTimeField(auto_now_add=True)
    revoked_by = models.CharField(max_length=64, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["book", "signer"],
                condition=Q(revoked_at__isnull=True),
                name="uniq_active_signature_per_book_person",
            )
        ]

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None
