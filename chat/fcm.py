import logging
import firebase_admin
from firebase_admin import credentials, messaging
from django.conf import settings

logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK (once)
_firebase_app = None

def _init_firebase():
    global _firebase_app
    if _firebase_app is not None:
        return
    try:
        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info('[FCM] Firebase Admin SDK initialized')
    except Exception as e:
        logger.warning(f'[FCM] Firebase init failed: {e}')


def send_fcm_notification(user_id, title, body, data=None, priority='high'):
    """Send FCM notification to all devices of a user."""
    from accounts.models import FCMDevice

    _init_firebase()
    if _firebase_app is None:
        return

    devices = FCMDevice.objects.filter(user_id=user_id, active=True)
    if not devices.exists():
        return

    tokens = list(devices.values_list('registration_id', flat=True))

    # Build Android-specific config for high priority
    android_config = messaging.AndroidConfig(
        priority='high',
    )

    # Data-only message (NO notification field!) so onMessageReceived is ALWAYS called
    msg_data = data or {}
    msg_data['title'] = title
    msg_data['body'] = body

    stale_tokens = []

    for token in tokens:
        try:
            message = messaging.Message(
                android=android_config,
                data=msg_data,
                token=token,
            )
            messaging.send(message)
        except messaging.UnregisteredError:
            stale_tokens.append(token)
        except messaging.SenderIdMismatchError:
            stale_tokens.append(token)
        except Exception as e:
            logger.warning(f'[FCM] Error sending to {token[:30]}: {e}')

    # Cleanup stale tokens
    if stale_tokens:
        FCMDevice.objects.filter(registration_id__in=stale_tokens).delete()
        logger.info(f'[FCM] Cleaned {len(stale_tokens)} stale token(s)')


def send_fcm_call_notification(user_id, caller_name, call_type, call_id=None, caller_id=None):
    """Send high-priority FCM for incoming call."""
    from accounts.models import FCMDevice

    _init_firebase()
    if _firebase_app is None:
        return

    devices = FCMDevice.objects.filter(user_id=user_id, active=True)
    if not devices.exists():
        return

    tokens = list(devices.values_list('registration_id', flat=True))

    call_label = 'Video Call' if call_type == 'video' else 'Voice Call'

    # DATA-ONLY message for calls (NO notification field!)
    # This ensures onMessageReceived is ALWAYS called even when app is in background
    # If notification field is present, Android shows its own notification and skips our code
    android_config = messaging.AndroidConfig(
        priority='high',
    )

    stale_tokens = []

    for token in tokens:
        try:
            message = messaging.Message(
                android=android_config,
                data={
                    'type': 'call',
                    'caller_name': caller_name,
                    'call_type': call_type,
                    'call_id': str(call_id or ''),
                    'caller_id': str(caller_id or ''),
                },
                token=token,
            )
            messaging.send(message)
        except messaging.UnregisteredError:
            stale_tokens.append(token)
        except messaging.SenderIdMismatchError:
            stale_tokens.append(token)
        except Exception as e:
            logger.warning(f'[FCM] Call notification error for {token[:30]}: {e}')

    if stale_tokens:
        FCMDevice.objects.filter(registration_id__in=stale_tokens).delete()


def send_fcm_call_cancel(user_id, call_id=None):
    """Send high-priority FCM to cancel/dismiss a call notification on receiver's device."""
    from accounts.models import FCMDevice

    _init_firebase()
    if _firebase_app is None:
        return

    devices = FCMDevice.objects.filter(user_id=user_id, active=True)
    if not devices.exists():
        return

    tokens = list(devices.values_list('registration_id', flat=True))

    android_config = messaging.AndroidConfig(
        priority='high',
    )

    stale_tokens = []

    for token in tokens:
        try:
            message = messaging.Message(
                android=android_config,
                data={
                    'type': 'call_cancel',
                    'call_id': str(call_id or ''),
                },
                token=token,
            )
            messaging.send(message)
        except messaging.UnregisteredError:
            stale_tokens.append(token)
        except messaging.SenderIdMismatchError:
            stale_tokens.append(token)
        except Exception as e:
            logger.warning(f'[FCM] Call cancel error for {token[:30]}: {e}')

    if stale_tokens:
        FCMDevice.objects.filter(registration_id__in=stale_tokens).delete()
