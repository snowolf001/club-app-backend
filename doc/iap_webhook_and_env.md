# IAP Webhook & 环境变量配置

## iOS (Apple)

- **Webhook URL**
  - 生产环境: `https://club-app-backend-production.up.railway.app/api/subscriptions/webhooks/apple`
  - 配置位置: App Store Connect → App 信息 → App Store Server Notifications

- **环境变量**
  - `APPLE_SHARED_SECRET`：App Store Connect → 你的 App → App-Specific Shared Secret
  - `APPLE_BUNDLE_ID`：你的 App 的 bundle identifier
  - `IAP_MOCK_ENABLED`：本地/测试可用，生产必须为 `false` 或不设置

---

## Android (Google)

- **Webhook URL**
  - 生产环境: `https://club-app-backend-production.up.railway.app/api/subscriptions/webhooks/google`
  - 配置位置: Google Play Console → Monetization setup → Real-time developer notifications

- **环境变量**
  - `GOOGLE_SERVICE_ACCOUNT_JSON`：Google 服务账号 JSON 内容（用于 Play API 调用）
  - `GOOGLE_PROJECT_ID`：Google Cloud 项目 ID
  - `IAP_MOCK_ENABLED`：本地/测试可用，生产必须为 `false` 或不设置

---

> 建议将本文件与 `.env.example`、`APPLE_BACKEND_VERIFICATION_CHECKLIST.md` 一起维护，方便团队查阅和环境配置。
