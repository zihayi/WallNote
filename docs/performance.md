# 内存优化

Windows 11，双屏、四个桌面组件，同一组示例数据启动后空闲测量。下表记录 v0.5.0 的渲染优化。

| 项目 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 常驻渲染进程 | 7 | 1 |
| 私有提交内存 | 665.5 MB | 234.4 MB |
| 进程工作集加总 | 1225.6 MB | 737.8 MB |

私有提交内存减少约 **65%**。工作集加总包含重复计算的共享页，不等于整台电脑实际多用的物理内存。保留管理窗口时，优化版私有提交内存约为 275.5 MB。

打包版复测：1 个渲染进程，私有提交内存 236.6 MB；对应进程工作集加总 584.9 MB。

v0.6.0 启用内置 Wi-Fi 接收服务的打包版复测：1 个渲染进程，**私有提交内存 263.0 MB**，进程工作集加总 638.2 MB。这个数字包含随应用启动的接收服务及其启动进程，使用隔离数据和回环发现网络，不含真实手机日历。

主要调整：

- 桌面组件复用同站点渲染进程和图片缓存，保留沙箱及上下文隔离。
- 模糊壁纸预先生成小尺寸缓存，桌面组件不再实时模糊整屏图像。
- 静态桌面默认使用软件合成，减少图形进程的大型缓存。
- 管理窗口按需创建；关闭后空闲 30 秒自动释放。有未保存表单时保留。
- 按组件发送状态。背景不接收日程正文，时间表只接收所选日期，日历的其他日期只接收轻量记录。

实际占用会随壁纸、日程数量、打开窗口和驱动变化。可复测：

```powershell
npm run build
node scripts/measure-memory.mjs current
node scripts/measure-memory.mjs release --packaged
node scripts/smoke-memory.mjs

# 包含内置 Wi-Fi 接收服务（隔离数据、回环网络）
$env:WALLNOTE_ENABLE_WIFI_RECEIVER = '1'
$env:WALLNOTE_WIFI_TEST_LOOPBACK = '1'
node scripts/measure-memory.mjs wifi-release --packaged
```

测量结果按标签写入 `test-results/memory-<标签>.json`。测试使用独立数据目录，不读取真实日历。

若特定显卡环境的软件合成有显示问题，可在退出应用后设置 `WALLNOTE_HARDWARE_RENDERING=1` 再启动，以恢复硬件合成。
