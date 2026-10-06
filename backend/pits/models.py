from django.contrib.auth.hashers import check_password, make_password
from django.db import models


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
    """联签簿：同一坑同一时刻只许一本未撤回（现行）簿。"""

    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="sign_books")
    created_by = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    withdrawn_by = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pit"],
                condition=models.Q(withdrawn_at__isnull=True),
                name="uniq_active_book_per_pit",
            )
        ]


class Signature(models.Model):
    """签字：签字人、时刻、可空撤回时刻；同坑未撤回签字按人去重。"""

    book = models.ForeignKey(SignBook, on_delete=models.CASCADE, related_name="signatures")
    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="signatures")
    signer = models.CharField(max_length=64)
    signed_at = models.DateTimeField(auto_now_add=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    withdrawn_by = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pit", "signer"],
                condition=models.Q(withdrawn_at__isnull=True),
                name="uniq_active_signature_per_pit_signer",
            )
        ]
