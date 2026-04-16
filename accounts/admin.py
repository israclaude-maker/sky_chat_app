from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from accounts.models import CustomUser

@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ('username', 'email', 'is_active', 'is_online', 'last_seen', 'is_staff')
    list_filter = ('is_active', 'is_online', 'is_staff', 'is_superuser')
    search_fields = ('username', 'email')
    ordering = ('-date_joined',)
    
    fieldsets = UserAdmin.fieldsets + (
        ('Profile Info', {'fields': ('is_online', 'last_seen', 'profile_picture')}),
    )
