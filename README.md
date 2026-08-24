# dsh-svn-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/JinRyu-online/dsh-svn-plugin)](https://github.com/JinRyu-online/dsh-svn-plugin/releases)

SVN（Subversion）版本控制面板插件，面向 DeepSeek Harness Web GUI。以独立 tab 融入
`dsh-better-sidebar` 右侧边栏，覆盖 IDEA SVN 的基本功能（状态、提交、历史、对比、
搁置、冲突解决、分支/标签、仓库浏览、属性、分组、锁定、代码标注），并注入 `svn_*`
模型工具，让 Agent 也能直接操作 SVN。

> 适用场景：团队仍在使用 SVN 管理代码，同时用 DeepSeek Harness 的 Web GUI 编程。
> 该插件把 Git 面板同款的体验带到 SVN 工作副本上。

---

## 功能

| 面板 | 说明 |
|---|---|
| **本地修改** | `svn status --xml` 状态树，**Git 面板风格**：更改 / 未版本化 / 已忽略分组，字母徽章（M/A/D/?/!/C…）+ 图标操作；**分组与目录均可折叠**，条目按目录树组织 |
| **.gitignore 忽略** | 自动读取工作副本（含父目录）的 `.gitignore`，按 gitignore 规则把匹配的未版本化文件归入「已忽略」分组并默认隐藏（与 Git 行为一致） |
| **提交** | 底部提交栏（Ctrl+Enter）+ 提交信息 + 选择文件，未版本化文件自动 `svn add` |
| **更新 / 还原 / 清理** | `svn update`、`svn revert`、`svn cleanup` |
| **代码对比** | 工作副本 vs BASE 或版本区间 diff，彩色 unified 渲染 |
| **历史记录** | `svn log --xml -v`，Git 风格历史行（r123 + 摘要 / 作者 · 时间 · 文件数）；选中提交的详情区**悬浮固定在底部**，列表独立滚动；**点击变更文件即展开该文件的单文件 diff**（A/M/D 均支持，红色删除 / 绿色新增高亮），再次点击收起 |
| **搁置（Shelve）** | `svn shelve / unshelve / shelve-delete / shelve --list`（IDEA 同款暂存） |
| **冲突解决** | `svn resolve --accept working / mine-full / theirs-full` |
| **代码标注** | `svn blame` 逐行标注版本与作者 |
| **分支 / 标签** | `svn copy` 建分支、`svn switch` 切换、`svn merge -r a:b URL` 合并 |
| **仓库浏览** | `svn list` 浏览远程目录树，可检出 |
| **属性 / 分组 / 锁定** | `svn:ignore` 等属性、ChangeList 分组提交、lock/unlock |
| **检出** | 非工作副本目录内联检出 |
| **Agent 工具** | `svn_status` / `svn_log` / `svn_diff` / `svn_commit` / `svn_update` / `svn_revert` / `svn_add` / `svn_shelve` / `svn_unshelve` / `svn_shelve_list` / `svn_blame` |

> **UI 风格**：与 dsh-better-sidebar 的「源代码管理（Git）」面板共用同一套
> DSW 设计 token（`--dsw-alias-*` 颜色 / `--dsw-font-*` 字号）与图标
> （`@deepseek-ai/dsh-client-ui-primitives`），视觉上保持一致。

---

## 依赖条件

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| **DeepSeek Harness（DSH）** | `0.1.0-rc.8+` | 宿主平台；`dsh web` 可正常运行 |
| **dsh-better-sidebar** | `≥ 0.14.0` | **必须安装**：提供 `ctx.betterSidebar` 侧边栏宿主服务，插件以 tab 形式注入其中 |
| **SVN 命令行客户端** | 任意（含 1.14.x） | 系统 `svn` 可执行文件；Windows 上 TortoiseSVN 自带 `svn.exe`，需加入 `PATH` |
| **Node.js** | 与 DSH 宿主一致 | 仅在开发/构建时需要（`pnpm install` / `pnpm build`） |

> **搁置（Shelve）可用性**：插件启动时检测 `svn help` 是否包含 `shelve` 子命令。
> TortoiseSVN 自带的 `svn.exe`（≤1.14.x）**刻意不包含** shelve 命令，此时「搁置」
> 面板会显示提示并禁用相关按钮，其余功能不受影响；改用上游 Apache Subversion
> 官方二进制（含 `shelve`）后自动恢复。

---

## 安装

### 从 GitHub 发布包 / npm 安装

```sh
# 确保已安装 dsh-better-sidebar（本插件的宿主插件）
dsh plugin --profile web add dsh-better-sidebar

# 安装本插件
dsh plugin --profile web add dsh-svn-plugin
```

### 本地开发安装

```sh
dsh plugin --profile web add e:/dsh_project/dsh-svn-plugin
```

装完**重启 `dsh web` 宿主进程**（宿主端路由与工具需重启加载），再**硬刷新浏览器**
（Ctrl+Shift+R）。侧边栏 + 菜单中应出现「SVN」tab。

---

## 开发

```sh
pnpm install
pnpm build      # tsc 编译宿主端 → lib/，tsdown 打包 client → client/client.js
```

宿主端：`src/index.ts`（`/svn/api` 路由 + `svn_*` 工具注册）。
客户端：`src/client/index.tsx`（`ctx.betterSidebar.registerTab`）。

---

## 架构

```
src/
├── index.ts        # 宿主端：/svn/api/* JSON API + svn_* 工具（trust-fence）
├── svn.ts          # svn 命令封装（spawn + --xml 解析）
├── gitignore.ts    # .gitignore 解析 + 匹配（git check-ignore 语义子集）
├── wire.ts         # HTTP 信封 / 错误码
├── trust-fence.ts  # loopback / trustedHosts 信任围栏
└── client/
    ├── index.tsx   # 注册 dsh-svn tab（better-sidebar 服务）
    ├── api.ts      # /svn/api 类型化 fetch
    ├── SvnView.tsx # 主面板：Git 面板风格状态页 + 操作中心
    ├── HistoryView / DiffView / ShelveView / RepoBrowserView /
    │   BranchView / PropsView / ChangeListView / BlameView / AgentToolsView
    ├── ui.tsx      # DSW-token 原子组件（Btn/IconBtn/SectionHeader/…）
    └── locales.ts  # zh / en
```

---

## License

MIT
