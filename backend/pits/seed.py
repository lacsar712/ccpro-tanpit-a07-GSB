from pits.models import LiquorSample, Pit, User, Yard


def seed_demo() -> None:
    admin, _ = User.objects.get_or_create(username="admin", defaults={"role": "admin"})
    admin.role = "admin"
    admin.set_password("123456")
    admin.save()
    worker, _ = User.objects.get_or_create(username="worker", defaults={"role": "worker"})
    worker.role = "worker"
    worker.set_password("123456")
    worker.save()
    if Yard.objects.exists():
        return
    # 干净起步：一口鞣制中坑，最近酸碱度已落在 3.5～5.0 带内，尚无任何联签簿/签字。
    yard = Yard.objects.create(name="南冈鞣场", village="青皮村")
    pit = Pit.objects.create(
        yard=yard, code="中-1", status=Pit.STATUS_TANNING, row=0, col=0
    )
    LiquorSample.objects.create(pit=pit, ph=4.2, operator="worker")
