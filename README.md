<div align="center">
  <img src="docs/images/icon.png" width="64" alt="WallNote" />
  <h1>WallNote</h1>
  <p>Windows 桌面日历、时间安排、便签与待办。</p>
  <p><sub>Windows x64 · Electron + React · 本地存储</sub></p>
</div>

![桌面界面预览](docs/images/desktop.webp)

左侧是按小时排列的时间表，中间是日历，右侧是待办清单和便签。点击日期即可查看当天安排。组件直接嵌入 Windows 桌面，按 `Win + D` 后仍然显示。

## 功能

- **壁纸**：6 张内置壁纸，支持导入本地图片、收藏和多显示器。
- **日历**：切换月份、选择日期，查看、添加和编辑日程。
- **时间安排**：按小时查看选中日期的安排，与日历实时同步。
- **便签**：直接在桌面编辑，可拖动、缩放、换色，自动保存内容和位置。
- **待办**：添加任务、勾选完成、标记重要，支持筛选和排序。
- **外观**：圆角、半透明毛玻璃背景，可在偏好设置中关闭。
- **数据**：保存在本地，无需登录，可离线使用，支持 JSON 备份与恢复。

## 运行

需要 **Windows x64**、**Node.js 22.12+** 和 **.NET Framework 4.x**。

```powershell
git clone https://github.com/zihayi/WallNote.git
cd WallNote
npm ci
npm run dev
```

启动后按 `Win + D` 查看桌面。需要同时打开管理面板时，运行 `npm run dev -- --manage`。

## 操作

| 操作 | 入口 |
| --- | --- |
| 打开管理面板 | 双击托盘图标，或 `Ctrl + Alt + W` |
| 新建桌面便签 | 托盘右键 → 新建桌面便签 |
| 添加日程 | 点击时间表中的小时，或日历选中日期旁的 `+` |
| 更换壁纸 | 管理面板 → 壁纸收藏馆 → 设为桌面壁纸 |
| 移动、缩放组件 | 拖动顶部、右下角斜纹 |
| 暂停或退出 | 托盘右键菜单 |

关闭管理面板后，程序继续在后台运行。暂停或退出后显示原来的系统壁纸。更新版本前请先退出旧版。

升级后若保留了旧组件位置，可在「偏好设置 → 重置桌面组件位置」应用三栏布局。

## 构建

```powershell
npm test          # 数据与持久化测试
npm run build     # 构建应用
npm start         # 运行构建后的应用
npm run dist      # 打包 Windows 便携版
```

便携版输出到 `release/WallNote-<版本号>-portable.exe`，双击即可运行。`npm run test:ui` 和 `npm run test:desktop` 分别检查管理界面和真实桌面交互。

## 数据位置

默认保存在 `%APPDATA%/WallNote/`，可从「偏好设置」打开。JSON 备份包含日程、便签和待办，不包含图片。恢复不含日程的旧版备份时，当前日程会保留。完整迁移请退出程序后复制整个数据目录。
