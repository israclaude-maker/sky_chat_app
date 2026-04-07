import json
import logging
from pywebpush import webpush, WebPushException
from django.conf import settings

logger = logging.getLogger(__name__)


def send_push_notification(user_id, title, body, url='/', icon=None, tag='skychat'):
    """Send Web Push notification to all subscriptions of a user."""
    from accounts.models import PushSubscription

    subs = PushSubscription.objects.filter(user_id=user_id)
    if not subs.exists():
        print(f"[PUSH] No subscriptions for user_id={user_id}, skipping")
        return

    print(f"[PUSH] Sending to user_id={user_id}, {subs.count()} subscription(s), title='{title}'")

    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url,
        'icon': icon or '/static/icons/icon-192x192.png',
        'tag': tag,
    })

    vapid_claims = {
        'sub': settings.VAPID_ADMIN_EMAIL,
    }

    stale_endpoints = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {
                        'p256dh': sub.p256dh,
                        'auth': sub.auth,
                    }
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims=vapid_claims,
            )
        except WebPushException as e:
            status_code = getattr(e, 'response', None)
            if status_code and hasattr(status_code, 'status_code'):
                status_code = status_code.status_code
            else:
                status_code = None
            # 404/410 = subscription expired/invalid
            if status_code in (404, 410):
                stale_endpoints.append(sub.endpoint)
            else:
                logger.warning(f'[Push] Error sending to {sub.endpoint[:60]}: {e}')
        except Exception as e:
            logger.warning(f'[Push] Unexpected error: {e}')

    # Cleanup stale subscriptions
    if stale_endpoints:
        PushSubscription.objects.filter(endpoint__in=stale_endpoints).delete()
