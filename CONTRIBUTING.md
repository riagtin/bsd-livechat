# Contributing to BSD LiveChat

Thank you for your interest in contributing to **BSD LiveChat**! We welcome contributions from the community to make web-to-WhatsApp live chat seamless, robust, and accessible.

---

## 1. Code of Conduct
All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please be respectful and professional in all interactions.

---

## 2. Contributor License Agreement (CLA)
Before your pull request can be merged, you must sign our [Contributor License Agreement](CLA.md). When you open a pull request, the automated CLA Assistant bot will prompt you to review and sign the agreement.

---

## 3. Development Workflow

1. **Fork and Clone:**
   ```bash
   git clone https://github.com/riagtin/bsd-livechat.git
   cd livechat
   ```
2. **Install Dependencies:**
   Ensure you have Node.js 22 LTS and pnpm installed.
   ```bash
   pnpm install
   ```
3. **Environment Setup:**
   ```bash
   cp apps/gateway/.env.example apps/gateway/.env
   ```
4. **Build and Verification:**
   ```bash
   pnpm run build
   pnpm test
   ```

---

## 4. Coding Standards & Licensing Boundaries

* **Strict TypeScript:** No `any` types; all code must pass `pnpm exec tsc --noEmit`.
* **SPDX Headers:** Every source file must begin with the appropriate SPDX license identifier:
  - `// SPDX-License-Identifier: AGPL-3.0-only` for `apps/gateway` and `packages/widget`.
  - `// SPDX-License-Identifier: MPL-2.0` for `packages/sdk` and `packages/react`.
* **One-Way Dependency Rule:** Packages under `MPL-2.0` (`packages/sdk`, `packages/react`) MUST NEVER import code or types from `AGPL` packages (`apps/gateway`, `packages/widget`).
* **Zero Browser Alerts:** Never call `alert()`, `confirm()`, or `prompt()`. All UI dialogs and notifications must be custom Bintang Studio styled components.

---

## 5. Submitting Pull Requests
1. Create a descriptive branch: `git checkout -b feature/my-feature` or `fix/my-bugfix`.
2. Ensure tests pass and code compiles with 0 errors.
3. Open a pull request with a clear description of the problem solved.
