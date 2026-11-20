# 接入桌面模块

1. 在 `shared/modules.ts` 的 `modules` 添加稳定的 ID、中文名称、显示开关和 `tall`（旧版三栏布局的高度约束）。需要时指定 `minimum`，默认最小尺寸为 260 × 260。不要修改已有 ID 或设置键。
2. 在 `src/components/` 实现面板，接收 `PanelProps`，使用 `FrostedPanel` 承载标题、置顶、缩放及关闭操作；将 `src/components/LayoutStudio.tsx` 的画布图标补齐。在 `src/module-views.tsx` 用动态 `import()` 注册面板。桌面窗口和工作台预览共用这一入口。
3. 新模块会出现在「整理布局」中，不会自动挤占已有布局。选入后的模块可在设置、托盘中切换显示。命中区域取整张卡片的圆角边界，不要为每个按钮向原生层上报坐标。
4. 用到应用状态时，在 `shared/renderer-state.ts` 里补上 `stateForView` 的数据投影和 `viewInputs` 的更新依赖。用到独立服务时，仅在面板显示或功能明确启用时启动；面板移除时取消订阅，关闭监听并清理缓存。
5. 默认只允许置顶和收起当前模块。需要编辑数据时，在 `electron/widget-actions.ts` 中显式允许对应操作，或像文件抽屉一样提供校验发送方的专用 IPC。面板不直接调用本机 API。

验证：在「整理布局」中添加、取消、应用并移除模块，检查拖放、置顶、键盘操作和多屏回落。`npm test` 检查状态与布局，`node scripts/smoke-snap-layout.mjs` 检查桌面窗口实际位置。
