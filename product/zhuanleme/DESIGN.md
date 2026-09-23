---
name: 赚了么经营工作台
description: 先欢迎、按需展开的经营账本，与 DSH 原生对话协作。
colors:
  primary: "#3769ad"
  primary-hover: "#2c578e"
  profit: "#426d63"
  background: "var(--dsw-alias-bg-base, #fff)"
  foreground: "var(--dsw-alias-label-primary, #202124)"
  muted: "var(--dsw-alias-label-secondary, #69717d)"
  line: "var(--dsw-alias-border-l2, #e8e9ed)"
  soft: "var(--dsw-alias-bg-l1, #f5f6f8)"
  on-primary: "#fff"
  cost-bar: "#8692a2"
  cost-legend: "#8692a2"
  series-0: "#469a92"
  series-1: "#709bc6"
  series-2: "#a39acc"
  series-3: "#d5aa79"
  series-4: "#c98e9b"
  series-5: "#9dac90"
  error: "#b23b35"
  error-background: "#fff2ef"
typography:
  welcome:
    fontSize: "32px"
    fontWeight: 550
    letterSpacing: "-.03em"
  headline:
    fontSize: "23px"
    fontWeight: 650
    letterSpacing: "-.03em"
  title:
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "-.02em"
  section:
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
  label:
    fontSize: "12px"
  small:
    fontSize: "11px"
  metric:
    fontSize: "26px"
    fontWeight: 550
    letterSpacing: "-.035em"
rounded:
  control: "7px"
  alert: "8px"
  demo-label: "4px"
  welcome-logo: "12px"
spacing:
  xs: "5px"
  sm: "8px"
  control-gap: "10px"
  md: "12px"
  inset: "16px"
  section: "24px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  shop-child-active:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  demo-label:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.demo-label}"
    padding: "2px 6px"
  error-message:
    backgroundColor: "{colors.error-background}"
    textColor: "{colors.error}"
    rounded: "{rounded.alert}"
    padding: "12px"
---
# Design System: 赚了么经营工作台

## Overview

**Creative North Star: "摊开的经营账本"**

像一本摊开的经营账本：数字清楚、留白充足、操作简短。进入店铺先展示单区欢迎与行动入口；选择经营总览或账目明细后，才展开数据与 AI 双栏。账表以细线组织信息，原生 DSH 对话保留自己的组件、主题与排版。

Logo 来源为用户提供的赚了么品牌图片，存于 `assets/logo.png`，通过 `/zhuanleme/logo.png` 展示；完整保留图片，不重新绘制或更改内容。常规品牌图为 28px 方形，欢迎页为 48px 方形，均使用 contain 适配。

**Key Characteristics:**
- 细分隔线与平面信息层次。
- 对齐的小数、克制的蓝色操作与绿色利润。
- 单区欢迎，按需展开数据与对话，窄屏切换面板。
- 演示零售店持续标注虚拟数据，与真实店铺账本隔离。

## Colors

Primary 是沉静的品牌蓝，用于主要动作、收入柱、所选日期标签和可操作文字；profit 是低饱和绿色，用于利润数字、折线与圆点。收入与成本在同一日期位置从零基线重叠绘制，不相加；成本柱使用 cost-bar，图例保留 cost-legend。非所选日期的柱为 0.8 透明度，所选日期为 1；利润折线与圆点保持不透明。成本环形图以 series-0 至 series-5 区分六类费用，并配文字、占比与金额。错误用红色文字与淡红底色形成局部提醒。前置 token 记录当前浅色默认值与 DSH 别名，不另建全局主题。

**The Host Continuity Rule.** 插件中性色优先使用 DSH 主题别名；聊天、输入器与模型选择保持官方组件的排版与交互。

深色主题跟随 `body[data-ds-dark-theme]`，插件根作用域及店铺当前导航提供明确覆盖，精确映射记于 sidecar。日期输入使用 dark color-scheme；不要把插件的局部颜色覆盖扩大到宿主。

## Typography

账表使用系统无衬线字体与中文 PingFang SC 回退；前置 token 是插件作用域内的实际层级。原生对话沿用官方 DSH 字体与组件规则。正文为 13px、1.6 行高；标题紧凑，辅助文字低对比，金额使用 `font-variant-numeric: tabular-nums`。

桌面指标为 26px，1200px 以下为 23px，850px 以下为 21px。欢迎页标题为 32px、550 字重，手机为 25px；欢迎说明为 14px，手机为 12px。聊天空状态标题为 25px。窄屏账表标题为 21px。图表日期在 SVG 内默认 11px、手机 16px，以补偿图形缩放；图例默认 11px、手机 10px。

## Layout

工作区外侧保留宿主侧栏；店铺子目录提供同级的经营总览、账目明细与智能经营。智能经营默认收起，点击展开聊天列表，最右侧加号新建本店对话。首页为独立单区欢迎：62px 顶栏、居中品牌和行动入口、底部账本持久化说明；主区域内边距为 40px 24px 100px。直接打开对话时，仅显示官方聊天。

总览或明细在桌面展开双栏：数据列 `minmax(440px,1.25fr)`，对话列 `minmax(340px,1fr)`，中间单条边框。账表最大宽度 900px，内边距 28px 30px 40px；三个指标共用底部分隔线。成本区为 170px 环形图与剩余宽度的图例，间距 24px。明细表最小宽度 440px，表格容器负责横向滚动。

1200px 以下双栏为 `minmax(370px,1.15fr) minmax(300px,1fr)`；账表内边距 24px 20px，环形图列 135px、间距 14px。1100px 以下工具栏可换行，指标间距收为 8px；后置 1200px 规则继续决定列宽和指标字号。

850px 以下改为纵向容器，通过顶部当前数据面板／对话按钮仅显示一个面板。账表内边距 22px 16px，对话标题栏由 58px 收为 44px；环形图列 130px、间距 10px，图例金额另起行。搜索筛选区可换行，表格局部滚动。首页内边距 30px 20px 60px，行动入口纵排，顶栏隐藏辅助文字。侧栏窄态子导航使用带可访问名称的图标。

## Elevation & Depth

**The Quiet Structure Rule.** 通过留白、文字层级与细分隔线组织内容；不把指标包装成独立浮起的卡片。

当前店铺导航、表头和悬停行以 soft 底色区分，页面未使用本地浮起卡片或分段导航阴影。欢迎页、指标和空状态直接落在页面底色上。官方聊天输入器保留宿主自有层次。

## Shapes

本地控件保持 7px 轻圆角，错误提示为 8px，演示标签为 4px。趋势柱为 24px 宽、3px 圆角；收入与成本图例为小方块，利润图例为 12px × 2px 短线；环形图使用 21px 宽的圆环。Logo 使用 contain 保持原图比例，常规圆角为 7px、欢迎页为 12px。不要将本地控件圆角强加给官方对话输入器。

## Components

**账目明细：** Material React Table + MUI。清爽的白色工作区，无阴影外框卡片。保留 1px 横竖网格线与浅色表头，金额右对齐、等宽数字。边界细淡但明确；悬停和编辑焦点准确落在单元格。

- **Welcome:** 店铺首页展示品牌、简短说明及查看总览、查看明细、与 AI 协作三个入口；未选择店铺时提供演示店入口。收起面板回到首页。
- **Buttons:** 主要按钮使用品牌蓝与浅色文字，悬停切到 primary-hover；普通按钮透明，悬停使用 soft。焦点是 2px 品牌蓝描边并外移 2px。忙碌按钮半透明且使用等待指针。欢迎页按钮内边距为 11px 15px，其余为 7px 10px。
- **Inputs:** 单像素 line 边框、background 底色，与按钮一致的焦点环；日期输入宽 138px，表单字段两列排列，标签置于字段上方。搜索输入可伸展，类型筛选最大宽 140px。
- **Navigation:** 店铺子导航以细竖线组织总览、明细和智能经营，三个入口的标签对齐、字号一致；智能经营折叠按钮与最右侧加号分别操作，聊天列表缩进一级。当前项有浅底色、600 字重及 `aria-current=page`。窄屏数据／对话切换使用 soft 选中底色和 600 字重。
- **Ledger table:** 收入／支出标签切换；日期与发生时间合并为「日期」列，格式 YYYY-MM-DD HH:mm，未知时间只显示日期，可直接编辑；顶部撤销、新增、更多，下一行搜索。单元格点击无下划线直接编辑，编辑器继承单元格字号、字重、行高和对齐，点击时不放大文字或撑高行；Enter 或失焦自动保存，Esc 取消。新增使用无框表内录入行，填完必填项后按 Enter 或离开该行自动保存，Esc 放弃，每行常驻删除图标，点击直接删除；撤销与历史支持持久化的新增、编辑、删除并真实写回账本，冲突不覆盖。导出、筛选、间距、全屏和日期列设置放入更多。窄屏优先项目和金额，表格内部滚动，分页可访问标签跟随语言。发生时间可直接输入 HH:mm；退款、收付和账户通过业务字段开关显示。历史恢复、期间报表、日结和备份放在更多菜单。AI 和表格共享 SQLite 与版本控制，模型写入仍经确认卡片。
- **Draft review:** AI 工具在原生对话内呈现确认卡片，展示店铺、日期、类型、金额、备注与当前状态；修改与规则卡片展示前后内容。确认按钮立即提交，忙碌期间禁止重复操作；错误保留在卡片内并提供重读。卡片以 1px 细边框和 12px 圆角组织，14px 正文，金额等宽对齐；窄屏单列。紧凑对话折叠工具过程后，回合末尾仍展示核对卡片。账表仍保留待核对入口。
- **Conversation history:** 侧栏仅展示未归档聊天，13px 标题、34px 紧凑单行、长标题省略。悬停或键盘聚焦显示归档与更多图标，触屏常显；右键或 Shift+F10 打开顶层浮动菜单，置顶、归档及删除操作不撑开列表。智能经营标题的更多菜单打开独立的已归档对话／已删除对话窗口，包含店铺名、搜索、恢复及关闭。窗口最大 560px，手机留 16px 边距；浏览器处理焦点隔离。侧栏不显示历史分类、返回按钮、归档说明或成功提示。保留删除确认、失败重试、搜索、查看更多和持久置顶。
- **Trend:** 七天收入与成本共用每日横坐标、柱宽和零基线，成本覆盖收入，不相加或并排。成本高于收入时，用蓝色横线标出收入顶部。利润以 2px 折线和圆点表达，可延伸到零线以下；仅连接相邻且均非缺失的利润点，缺失处断线。缺失收入或成本不绘制对应柱，零值柱高为零；零利润圆点落在零线上。日期提供鼠标和键盘选择；网格为细虚线，选中日期强化标签、柱不透明度与利润圆点（半径由 3px 增为 4px）。
- **Cost donut:** 六类成本以环形图、名称、占比和金额共同表达；缺失项显示破折号，不绘制虚构扇区。中心区分完整成本与已知成本，无成本时保留空轨道和文字说明。成本依据在下方可展开。
- **Demo / empty / error:** 青禾生活为虚拟零售演示店；数据面板持续显示演示标签与隔离说明。空状态用简短标题与受限行宽说明；错误使用局部 error-message 并保留重试入口。

**The Honest Numbers Rule.** 缺失数据保留缺失状态，零值保持为零；图表表达所选店铺账目，虚拟演示数据必须明确标记。

账表面板仅在允许动态效果时执行 240ms ease-out 的轻微淡入与向上归位；减少动态效果偏好下不播放。

## Do's and Don'ts

### Do:
- Do 保留用户提供的完整 Logo。
- Do 默认展示欢迎页，由店铺子导航按需打开数据与对话。
- Do 使用等宽数字特性对齐金额，并保留两位小数。
- Do 让待核对草稿、已入账、已作废与演示数据以文字可辨。
- Do 保留键盘焦点与减少动态效果偏好。

### Don't:
- Don't 重绘 Logo 或替换官方 DSH 对话组件。
- Don't 把缺失金额显示为零或填充未标记的虚构趋势。
- Don't 为经营指标增加装饰性阴影、渐变或卡片层。

成本构成使用青绿、雾蓝、浅紫、杏色、玫瑰与鼠尾草绿，圆环线宽 18px。图例与圆环限制在 640px 内，桌面圆环 180px、间距 32px，避免分类与数字过度分离；容器小于 480px 时圆环居中、明细在下方，金额和占比保持同一行。

经营趋势的选中日期与加载范围分离；初次载入 30 天并定位最新端，每屏显示 7 天；隐藏滚动条，鼠标按住拖动、触控或区域方向键浏览，松手按日期对齐；左端载入前 30 天，前插数据补偿滚动宽度，点击不改变范围或滚动位置。切日读取时保留已挂载图表。

成本构成保留真实占比的中央圆环，左右均衡分布六项外置标注，使用灰色细曲线连接彩色锚点；名称、金额、占比分三层显示。窄容器切换为更高的 400×400 排布以保持文字可读，禁止简单缩小桌面图或删掉指示线。

成本标注优先放入足够宽的扇区；窄扇区保留外置细指示线。分类、金额与占比统一为 13px、400 字重，浅色扇区与深色文字保证阅读层次，真实占比不作调整。

成本构成以用户参考图为准：上半圆环、扇区白色间隔、内部旋转百分比、外侧名称与金额由短直线连接。极窄扇区的百分比随金额外置，避免挤入扇区。

半圆成本图默认仅显示分类与占比；百分比按扇区径向旋转，极窄扇区外置。点击或键盘选择分类后才显示金额、占比与依据，可再次点击、Escape 或关闭按钮收起；切换日期清除选中项。

经营总览首屏优先展示指标、趋势与成本图，移除收起面板按钮、演示说明段落和日结提示段落，压缩区块间距。错误状态与真实缺失数据仍按原逻辑显示。

店铺删除使用紧凑模态确认框，仅显示确认标题、店名、取消与删除按钮；取消默认获焦，Esc 可关闭，提交中禁止重复点击，失败在框内显示。侧栏不展开解释段落。

## 语音输入

按用户提供的输入器参考图，平时只保留一个麦克风，位于模型选择和发送之间。录音期间保留上方原生编辑器，底部整行替换为长灰色点线、右端短动态波形和三个圆形操作：取消、停止、发送。其他宿主工具暂时隐藏，停止后恢复。声音幅度驱动波形，不添加循环装饰动画。手机缩减点数并保留全部三个操作。识别中的等待仅以简短状态文字呈现，错误为紧邻入口的可关闭提示。实际中间识别结果直接写入草稿；取消恢复录音前内容，停止保留，发送等待最终结果。
