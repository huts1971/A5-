from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, CommunityPost, CommunityPostLike, utc_now


COMMUNITY_SEED_POSTS = (
    {
        "user_id": "community-seed-001",
        "username": "community_qingfeng",
        "author_name": "清风徐来",
        "content": "上午先去梵宫，再往大佛方向走会从容一些。梵宫的室内讲解很值得认真听。",
        "spot_id": "spot_brahma_palace",
        "days_ago": 2,
        "hours_ago": 4,
        "like_count": 3,
    },
    {
        "user_id": "community-seed-002",
        "username": "community_muyun",
        "author_name": "木云",
        "content": "九龙灌浴很适合带孩子看，建议提前几分钟到广场边缘找位置，视野会更完整。",
        "spot_id": "spot_nine_dragons",
        "days_ago": 1,
        "hours_ago": 3,
        "like_count": 8,
    },
    {
        "user_id": "community-seed-003",
        "username": "community_xiaolu",
        "author_name": "小鹿旅行",
        "content": "景区步行距离比想象中长，和长辈同行的话可以把路线安排得松一点，中途多留一些休息时间。",
        "spot_id": None,
        "days_ago": 0,
        "hours_ago": 2,
        "like_count": 2,
    },
    {
        "user_id": "community-seed-004",
        "username": "community_shanshui",
        "author_name": "山水同行",
        "content": "灵山大佛前的视野很开阔，下午光线柔和一些，拍照时也不容易逆光。",
        "spot_id": "spot_ling_shan_buddha",
        "days_ago": 0,
        "hours_ago": 5,
        "like_count": 6,
    },
    {
        "user_id": "community-seed-005",
        "username": "community_anning",
        "author_name": "慢游阿宁",
        "content": "从入口一路走到五智门节奏很舒服，第一次来可以先沿中轴线走，方向比较好认。",
        "spot_id": "spot_ls_004",
        "days_ago": 0,
        "hours_ago": 8,
        "like_count": 1,
    },
    {
        "user_id": "community-seed-006",
        "username": "community_jiangnan",
        "author_name": "江南旅人",
        "content": "梵宫内部细节很多，建议至少预留四十分钟，跟着讲解看会比匆匆走过更有收获。",
        "spot_id": "spot_brahma_palace",
        "days_ago": 1,
        "hours_ago": 6,
        "like_count": 7,
    },
    {
        "user_id": "community-seed-007",
        "username": "community_weekend",
        "author_name": "周末散步",
        "content": "菩提大道树荫不少，上午走很清静。鞋子尽量选轻便的，全天游览会舒服很多。",
        "spot_id": "spot_ls_005",
        "days_ago": 1,
        "hours_ago": 10,
        "like_count": 4,
    },
    {
        "user_id": "community-seed-008",
        "username": "community_family",
        "author_name": "带娃看世界",
        "content": "百子戏弥勒很适合亲子停留，孩子会主动找雕塑里的小细节，旁边也方便稍作休息。",
        "spot_id": "spot_ls_009",
        "days_ago": 2,
        "hours_ago": 7,
        "like_count": 9,
    },
    {
        "user_id": "community-seed-009",
        "username": "community_photographer",
        "author_name": "拾光摄影",
        "content": "灵山大照壁正面适合拍全景，稍微往侧边移动一点，可以把远处山景也带进画面。",
        "spot_id": "spot_ls_001",
        "days_ago": 3,
        "hours_ago": 5,
        "like_count": 5,
    },
    {
        "user_id": "community-seed-010",
        "username": "community_tea",
        "author_name": "一杯清茶",
        "content": "祥符禅寺的氛围很安静，走到这里可以放慢一点，留些时间感受院落和钟声。",
        "spot_id": "spot_xiangfu_temple",
        "days_ago": 3,
        "hours_ago": 11,
        "like_count": 3,
    },
    {
        "user_id": "community-seed-011",
        "username": "community_cloudwalk",
        "author_name": "云端漫步",
        "content": "阿育王柱附近适合顺路了解佛教传播历史，和前后的景点连起来看会更容易理解。",
        "spot_id": "spot_ls_008",
        "days_ago": 4,
        "hours_ago": 4,
        "like_count": 6,
    },
    {
        "user_id": "community-seed-012",
        "username": "community_firstvisit",
        "author_name": "初见灵山",
        "content": "第一次来不建议把行程排得太满，选几个重点景点认真看，整体体验反而更从容。",
        "spot_id": None,
        "days_ago": 5,
        "hours_ago": 6,
        "like_count": 2,
    },
)


def ensure_community_seed_data(session: Session) -> None:
    now = utc_now()
    changed = False
    seeded_posts: dict[str, CommunityPost] = {}

    for seed in COMMUNITY_SEED_POSTS:
        user = session.get(AppUser, seed["user_id"])
        if not user:
            user = AppUser(
                id=seed["user_id"],
                username=seed["username"],
                password_hash="disabled-community-seed-account",
                role="visitor",
                is_active=False,
                created_at=now - timedelta(days=int(seed["days_ago"]) + 1),
            )
            session.add(user)
            session.flush()
            changed = True

        post = session.scalar(
            select(CommunityPost).where(
                CommunityPost.author_id == seed["user_id"],
            )
        )
        if not post:
            created_at = now - timedelta(
                days=int(seed["days_ago"]),
                hours=int(seed["hours_ago"]),
            )
            post = CommunityPost(
                author_id=user.id,
                author_name=seed["author_name"],
                content=seed["content"],
                spot_id=seed["spot_id"],
                status="published",
                created_at=created_at,
                updated_at=created_at,
            )
            session.add(post)
            session.flush()
            changed = True
        seeded_posts[seed["user_id"]] = post

    seed_user_ids = [seed["user_id"] for seed in COMMUNITY_SEED_POSTS]
    for seed in COMMUNITY_SEED_POSTS:
        post = seeded_posts[seed["user_id"]]
        if post.status != "published":
            continue

        liker_ids = [
            user_id
            for user_id in seed_user_ids
            if user_id != seed["user_id"]
        ][: int(seed["like_count"])]
        if not liker_ids:
            continue

        existing_liker_ids = set(
            session.scalars(
                select(CommunityPostLike.user_id).where(
                    CommunityPostLike.post_id == post.id,
                    CommunityPostLike.user_id.in_(liker_ids),
                )
            ).all()
        )
        for index, liker_id in enumerate(liker_ids):
            if liker_id in existing_liker_ids:
                continue
            session.add(
                CommunityPostLike(
                    post_id=post.id,
                    user_id=liker_id,
                    created_at=post.created_at + timedelta(minutes=index + 1),
                )
            )
            changed = True

    if changed:
        session.commit()
