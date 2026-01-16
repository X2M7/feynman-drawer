# Feynman Drawer V0.1

一个基于浏览器的费曼图绘制器，支持拖拽绘图、曲线控制点、KaTeX 标签，以及 TikZ 代码的双向同步与导出。

## 功能亮点
- 基础元素：点 / 直线 / 曲线 / 椭圆 / 标签
- 线型与样式：实线、虚线、点线、波浪线、弹簧线，支持箭头与线宽/颜色
- 交互：选中曲线可拖动控制点；标签可绑定到线的起点/中点/终点并设置偏移
- 视图：平移、缩放、网格开关；支持触控双指缩放
- 代码：TikZ 子集编辑与应用（Ctrl/⌘ + Enter），一键复制/导出
- 导出：TikZ 代码与 PNG 图片
- 离线：注册 Service Worker，可用于离线访问

## 快速开始
1. 直接打开 `index.html`（中文界面）或 `index-en.html`（英文界面）。
2. 在左侧选择工具绘制图形，右侧查看/编辑 TikZ 代码。

> 这是纯前端项目，无需安装依赖或构建。

## 基本操作
- 选择工具：点击左侧工具按钮
- 画布平移：切换到 Hand 工具，或按住 Space 临时平移
- 缩放：Ctrl/⌘ + 滚轮，或使用右侧的缩放按钮
- 删除：Delete 键或使用“删除”工具
- 曲线控制点：选中曲线后拖动控制点调整形状
- 标签：双击标签可编辑；可绑定到线段并设置偏移

## TikZ 支持子集
- 点：`\fill (x,y) circle (r);`
- 线段：`\draw[style] (a) -- (b);`
- 曲线：`\draw[style] (a) .. controls (c) .. (b);`
- 椭圆：`\draw[style] (x,y) ellipse (a and b);`
- 标签：`\node at (x,y) { ... };`

说明：
- 坐标采用 `1 TikZ unit = 20 px` 的映射。
- 线型中的 wavy/spring 会映射到 TikZ 的 `snake/coil` 装饰。
- 中点箭头与中点叉号会在导出时使用注释 `fd-arrow` 来保留语义。

## 文件结构
- `index.html`：中文界面入口
- `index-en.html`：英文界面入口
- `style.css`：样式
- `app.js`：核心逻辑
- `service-worker.js`：离线支持
- `manifest.json`：PWA 清单

## 依赖
- [Fabric.js](https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js)
- [KaTeX](https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js)
- [Font Awesome](https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css)

## 许可
MIT开源许可。
