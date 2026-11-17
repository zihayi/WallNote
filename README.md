<div align="center">
  <img src="docs/images/icon.png" width="64" alt="WallNote" />
  <h1>WallNote</h1>
  <p>Windows 桌面壁纸、便签和待办。</p>
  <p><sub>Windows x64 · Electron + React · 本地存储</sub></p>
</div>

![桌面界面预览](docs/images/desktop.webp)

WallNote 将壁纸和组件嵌入 Windows 桌面。桌面图标照常使用，按 `Win + D` 后便签和待办仍然显示，普通应用窗口会盖在它们上方。

## 功能

- **壁纸**：6 张内置壁纸，支持导入本地图片、收藏和多显示器。
- **便签**：直接在桌面编辑，可拖动、缩放、换色，自动保存内容和位置。
- **待办**：添加任务、勾选完成、标记重要，支持筛选和排序。
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
| 更换壁纸 | 管理面板 → 壁纸收藏馆 → 设为桌面壁纸 |
| 移动、缩放组件 | 拖动顶部、右下角斜纹 |
| 暂停或退出 | 托盘右键菜单 |

关闭管理面板后，程序继续在后台运行。暂停或退出后显示原来的系统壁纸。更新版本前请先退出旧版。

## 构建

```powershell
npm test          # 数据与持久化测试
npm run build     # 构建应用
npm start         # 运行构建后的应用
npm run dist      # 打包 Windows 便携版
```

便携版输出到 `release/WallNote-<版本号>-portable.exe`，双击即可运行。`npm run test:ui` 和 `npm run test:desktop` 分别检查管理界面和真实桌面交互。

## 数据位置

默认保存在 `%APPDATA%/WallNote/`，可从「偏好设置」打开。JSON 备份包含便签和待办，不包含图片；完整迁移请退出程序后复制整个数据目录。
