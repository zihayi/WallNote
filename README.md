<div align="center">
  <img src="docs/images/icon.png" width="64" alt="WallNote" />
  <h1>WallNote</h1>
  <p>Windows 桌面日历、时间安排、便签与待办。</p>
  <p><sub>Windows x64 · Electron + React · 本地存储</sub></p>
</div>

![桌面界面预览](docs/images/desktop.webp)

时间表、日历、待办和便签以三栏居中排列，边缘与间距统一对齐。组件默认在桌面图标下方，图标优先响应；点击组件图钉才会置于其他窗口上方。

## 功能

- **壁纸**：6 张内置壁纸，支持导入本地图片、收藏和多显示器。
- **日历**：切换月份、选择日期，查看、添加和编辑日程。
- **时间安排**：按小时查看选中日期的安排，与日历实时同步。
- **便签**：直接编辑、换色和自动保存；多张便签在右侧面板切换，不再堆叠。
- **待办**：添加任务、勾选完成、标记重要，支持筛选和排序。
- **外观**：平滑圆角、毛玻璃背景和细滚动条，支持不同屏幕缩放比例。
- **数据**：保存在本地，无需登录，可离线使用，支持 JSON 备份与恢复。
- **手机日历**：同一 Wi-Fi 自动发现 Android 手机，首次确认配对后自动重连，可同步显示并提交新增、修改。
- **内存**：桌面共享渲染进程，模糊背景使用缓存，管理窗口按需加载。双屏含 Wi-Fi 接收服务测试私有内存约 263 MB，详见[测量说明](docs/performance.md)。

## 下载安装（Windows x64）

[下载最新安装版](https://github.com/zihayi/WallNote/releases/latest)。选择 `WallNote-Setup-<版本>-x64.exe`，运行安装向导。默认安装到当前用户，也可选择安装目录。安装后可从开始菜单或桌面快捷方式启动，无需另装 Node.js 或 Python。

- **更新或从旧便携版迁移**：先从托盘退出 WallNote，再运行新安装包。同一 Windows 用户的日程、便签和手机配对信息会继续沿用。
- **登录时启动**：安装后可在「偏好设置 → 开机启动」开启，默认关闭。
- **卸载**：在 Windows「设置 → 应用 → 已安装的应用」中卸载 WallNote。默认保留 `%APPDATA%\WallNote` 下的个人数据。
- Release 附有同名 `.sha256` 文件，可用 `Get-FileHash .\WallNote-Setup-<版本>-x64.exe -Algorithm SHA256` 核对下载。

## 从源码运行

需要 **Windows x64**、**Node.js 22.12+** 和 **.NET Framework 4.x**。开发模式下使用手机同步还需要 Python 3.10+ 和 `cryptography`。

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
| 更换壁纸 | 管理面板 → 壁纸库 → 设为桌面壁纸 |
| 置顶组件 | 点击组件右上角的图钉 |
| 移动、缩放组件 | 置顶后拖动顶部、右下角斜纹 |
| 恢复对齐 | 取消置顶，自动回到桌面网格 |
| 查看手机连接 / 配对 | 点击桌面日历标题栏或管理面板右上角的「手机同步」 |
| 暂停或退出 | 托盘右键菜单 |

关闭管理面板后，程序继续在后台运行。窗口淡入淡出、组件收起和图钉反馈会跟随系统的减少动态效果设置。暂停或退出后显示原来的系统壁纸。更新版本前请先退出旧版。

升级会应用新的居中布局并保留内容。也可在「偏好设置 → 重置桌面组件位置」重新排列。

## 构建

```powershell
npm test          # 数据与持久化测试
npm run build     # 构建应用
npm start         # 运行构建后的应用
npm run dist      # 生成 Windows x64 安装程序和 SHA-256 校验文件
```

正式发行只上传 `release/WallNote-Setup-<版本>-x64.exe` 和同名 `.sha256` 文件。`npm run test:ui` 检查界面，`node scripts/smoke-layer.mjs` 检查层级与多屏尺寸；`npm run test:desktop` 会短暂操作鼠标键盘以验证真实桌面交互。

安装包内置 Wi-Fi 接收服务。构建前在 Python 环境执行 `python -m pip install -r receiver/requirements-build.txt`。仓库的 `receiver/` 已包含构建所需源码，无需其他本地工程。可用 `CALENDAR_BUILD_PYTHON` 指定构建用 Python，开发模式下用 `CALENDAR_PYTHON` 指定解释器。

## 手机同步

使用 WallNote v0.6.2 和 CalendarBridge Android v4.0 或更新版本：

1. 手机和电脑连接同一 Wi-Fi，打开 WallNote 和手机日历助手。
2. 点击 WallNote 桌面日历或管理面板上的「手机同步 → 配对手机」。
3. 手机搜索电脑，核对两端显示的六位验证码后，在电脑确认配对。

入口会区分「等待手机」「手机在线」「手机离线」和接收服务异常。点击「刷新状态」可重新检查连接并读取最新快照；手机日程的来源统一显示为「手机同步」。

首次配对后自动重连，不需要 USB 或配置文件。接收服务随 WallNote 运行，电脑 IP 改变时仍需验证已配对证书。手机获得读取权限后同步日历；需要写入时再开启手机编辑开关并选择可写日历。Android 后台自动同步约每 15 分钟，实际执行受省电策略影响。

已有独立接收服务可在「高级：连接独立接收服务」中导入原来的 `wallnote-connection.json`。Wi-Fi 不允许设备互访时，请检查访客隔离和本地网络权限。

手机来源日程按北京时间显示；重复、全天和跨天日程只读。手机需开启电脑编辑权限，回执和快照确认前均显示待确认。不支持删除手机日程，也不会自动重放不确定操作。

`node scripts/smoke-wifi.mjs` 验证自动启动、发现、验证码配对、只读同步、重启后身份保留和退出清理；加 `--packaged` 验证打包后的内置服务。测试使用回环网络和模拟数据。

## 数据位置

默认保存在 `%APPDATA%/WallNote/`，可从「偏好设置」打开。JSON 备份包含日程、便签和待办，不包含图片。恢复不含日程的旧版备份时，当前日程会保留。完整迁移请退出程序后复制整个数据目录。
