import re


def detect_platform(request):
    platform = request.headers.get("X-Client-Platform", "").lower()
    if platform in ("android", "electron", "web"):
        return platform

    ua = request.META.get("HTTP_USER_AGENT", "").lower()
    if "electron" in ua:
        return "electron"
    if "android" in ua or "wv" in ua:
        return "android"
    if ua:
        return "web"
    return "unknown"


def get_client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def get_device_name(request):
    # 1) Client ne khud bheja ho (header ya body)
    name = (
        request.headers.get("X-Device-Name")
        or request.data.get("device_name")
        or ""
    )
    name = str(name).strip()
    if name:
        return name[:255]

    ua = request.META.get("HTTP_USER_AGENT", "")

    # 2) App ne UA me "Device/..." laga diya ho
    m = re.search(r"Device/([^;)]+)", ua)
    if m:
        return m.group(1).strip().replace("_", " ")[:255]

    # 3) Android UA se model, e.g. "Android 13; TECNO KG5k Build/..."
    m = re.search(r"Android [\d.]+;\s*([^;)]+?)(?:\sBuild|;|\))", ua)
    if m and m.group(1).strip() not in ("K", "wv"):
        return m.group(1).strip()[:255]

    # 4) Browser + OS
    if "Edg/" in ua:
        browser = "Edge"
    elif "Firefox" in ua:
        browser = "Firefox"
    elif "Chrome" in ua:
        browser = "Chrome"
    elif "Safari" in ua:
        browser = "Safari"
    else:
        browser = "Browser"

    if "Windows" in ua:
        os_name = "Windows"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    elif "Mac OS" in ua:
        os_name = "Mac"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = ""

    return f"{browser} on {os_name}".strip()[:255]