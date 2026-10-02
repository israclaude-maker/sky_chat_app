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