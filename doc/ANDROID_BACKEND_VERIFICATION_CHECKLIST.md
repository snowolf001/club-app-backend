# Android Backend Verification Checklist

手动检查 Android 订阅后端在生产环境上线前的准备情况。
建议先在 **sandbox/test** 环境验证，再上线生产。

---

## 0. 前置条件

- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` 已设置（Google Cloud 服务账号 JSON 内容，Play API 用）
- [ ] `GOOGLE_PROJECT_ID` 已设置（Google Cloud 项目 ID）
- [ ] `IAP_MOCK_ENABLED` 在生产环境为 **未设置** 或 `false`
- [ ] Google Play Console 已配置 Real-time developer notifications，webhook URL 正确
- [ ] 有可用的测试账号用于购买测试

---

## 1. 验证 endpoint — 正常流程

**场景：** 有效 Android 订阅首次购买。

1. 在 Android App 上用测试账号购买订阅。
2. 调用 `POST /api/subscriptions/verify`，参数：
   ```json
   {
     "clubId": "<valid-club-uuid>",
     "platform": "android",
     "productId": "passeo_pro_monthly",
     "purchaseToken": "<from-Google>",
     "orderId": "<from-Google>"
   }
   ```
3. **期望：**
   - HTTP 200
   - `data.isPro = true`
   - `data.activeSubscription` 包含 `platform: "android"`, `status: "active"`
   - `data.billingState = "active_renewing"` 或 `"active_cancelled"`
   - `data.createdSubscription.id` 与 `data.activeSubscription.id` 相同
   - `data.idempotent = false`
4. **DB 检查：** `SELECT * FROM club_subscriptions WHERE id = '<returned-id>'`，确认 `status='active'`，`platform='android'`，`ends_at` 已设置。

---

## 2. 验证 endpoint — 幂等性（同 orderId）

**场景：** 客户端用同一个 orderId 重复调用 verify。

1. 重复第 1 步的调用。
2. **期望：**
   - HTTP 200
   - `activeSubscription.id` 与前一次相同
   - `data.idempotent = true`
3. **DB 检查：** 没有新行产生，club 订阅行数不变。

---

## 3. 验证 webhook — 续订/取消/过期

**场景：** Google Play 通知 webhook 被触发（如续订、取消、过期等）。

1. 在 Google Play Console 或测试环境触发相关事件。
2. 检查 webhook 是否被正确接收并处理。
3. **期望：**
   - 订阅状态在数据库中被正确更新
   - 日志中有 webhook 处理记录

---

> 建议结合 iap_webhook_and_env.md 文档，统一维护环境变量和 webhook 配置。
