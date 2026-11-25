# 比格桌面宠物 · 建模需求清单 v1

## 0. 怎么用这份清单

顺序：**设定图 → 定稿 → 3D 模型 → 骨骼 → 表情形态键 → 动画 → 道具 → 场景**。每一步定稿后再走下一步，先做 P0。

- 第 2、3、7、8 节的图让 GPT 出，提示词在第 9 节，直接复制。
- 第一张满意的图（成年三视图）定稿后，后面每次都把它作为参考图一起发给 GPT，并加一句 `Keep exactly the same character and markings.`，不然每张图会变成不同的狗。
- 第 4、5、6 节是给 3D 建模、绑骨骼、做动画用的技术要求，模型做出来按这几节验收。
- 第 10 节是验收清单，每张图、每个模型都过一遍。

---

## 1. 角色总设定（所有图和模型都按这个来）

**风格**：轻度风格化写实。身体结构和毛色按真比格，眼睛稍大、眼神更柔，可爱但不卡通。不要描边，不要拟人（不站立、不穿衣服、没有人手）。

**大小**：成年肩高约 35 厘米。

**经典三色毛色分布**

| 部位 | 颜色 |
|---|---|
| 背部鞍形斑：肩胛后方到尾根，盖住背和体侧上半 | 黑色 |
| 头、耳朵、肩膀、大腿外侧 | 暖棕褐色 |
| 额头白纹：两眼之间一路往下，和白色口鼻连成一片 | 白色 |
| 口鼻、下巴、胸口、肚子、四肢下半段 | 白色 |
| 尾巴：根部到中段 | 黑色或棕色 |
| 尾尖最后约四分之一 | 白色（比格标志性的"白旗"） |
| 口鼻两侧、腿上的少量小斑点 | 浅褐色（可选） |
| 鼻子 | 黑色 |
| 眼睛 | 深棕或榛色，眼神温和、有点"求求你"的感觉 |
| 肉垫 | 幼犬以粉色为主，成年深灰带粉 |

**比格的特征，画错了就不像比格**

- 耳朵：长在头两侧偏低的位置，长、宽、薄、软，贴着脸颊下垂，尖端圆。往前拉直几乎能碰到鼻尖。
- 尾巴：中等偏短，翘起时略弯，不卷到背上，下侧毛稍密。
- 头：头顶微圆，口鼻方正，不要尖。
- 身体：胸深、背平，腿直，整体结实，不是细长型。

**不同月龄的比例**（长大不是整体放大，各部位分开长）

| 月龄 | 头 | 眼睛 | 口鼻 | 腿 | 爪子 | 肚子 | 颜色 |
|---|---|---|---|---|---|---|---|
| 2 个月（刚到家） | 相对身体很大 | 大，位置偏低 | 短 | 短 | 显得很大 | 圆滚 | 头顶和耳朵偏深 |
| 4 个月 | 仍偏大 | 大 | 开始变长 | 开始拉长 | 偏大 | 偏圆 | 开始变浅 |
| 6 个月（青春期） | 接近正常 | 正常 | 中等 | 先长到位 | 正常 | 偏瘦 | 接近成年 |
| 9 个月 | 正常 | 正常 | 接近成年 | 成年 | 正常 | 正常 | 成年 |
| 12 个月（成年） | 和身体协调 | 正常 | 成年长度 | 成年 | 正常 | 正常 | 成年 |

注：很多三色比格小时候黑色面积更大、头部颜色更深，长大后会褪成棕色。这里按这个常见情况设计。

**盲盒的先天外观差异**（稀有度只体现在外观上，不影响能力）

| 变体 | 稀有度 |
|---|---|
| 经典三色 | 常见 |
| 红白 | 常见 |
| 柠檬白（很浅的黄白） | 少见 |
| 巧克力三色（黑色换成巧克力色） | 稀有 |

同一种毛色里，每只狗再随机：鞍形斑大小、额头白纹宽窄、口鼻和腿上的斑点多少、尾尖白的长短。

---

## 2. 设定图清单

| 编号 | 内容 | 要求 | 优先级 |
|---|---|---|---|
| A | 成年三视图 | 正面、侧面、背面、3/4 前侧；标准站姿，四条腿分开、全部可见；浅灰背景，均匀柔光，无投影，无文字 | P0 |
| B | 2 个月幼犬三视图 | 同 A，花色和 A 完全一致 | P0 |
| C | 毛色分布图 | 俯视加侧视，黑、棕、白的边界清楚，平光 | P0 |
| D | 表情表 | 4×4 共 16 格，内容见第 3 节 | P0 |
| E | 月龄对比 | 2、4、6、9、12 个月侧面并排，同一比例尺 | P1 |
| F | 细节特写 | 眼睛、鼻子、耳朵内侧、爪子和肉垫、尾尖 | P1 |
| G | 毛色变体 | 第 1 节的 4 种毛色并排 | P1 |
| H | 关键姿势 | 坐、趴、下巴搁爪子、蜷着睡、邀玩、抬一只前爪、歪头、挠痒、伸懒腰、翻肚皮、被拎起悬空 | P2 |
| I | 道具表 | 见第 7 节 | P1 |
| J | 盲盒 | 关着、绑带松开、盖子掀开幼犬探头，三个状态 | P0 |

---

## 3. 表情清单

16 个表情，对应宠物的各个状态。3D 里靠"形态键 + 耳朵骨骼"组合出来。

| # | 表情 | 用在 | 眼睛 | 眉 | 耳朵 | 嘴 |
|---|---|---|---|---|---|---|
| 1 | 平静 | 默认 | 正常睁开 | 平 | 自然下垂 | 闭合 |
| 2 | 开心喘气 | 开心、想玩 | 睁开 | 平 | 略向外张 | 张开、舌头伸出 |
| 3 | 开心眯眼 | 被摸、蹦跳 | 弯成月牙 | 平 | 向外张 | 微笑 |
| 4 | 好奇 | 好奇、看鼠标 | 睁大 | 两边上扬 | 耳根上提 | 闭合 |
| 5 | 委屈 | 委屈、被冷落 | 大、湿润，外眼角下垂 | 内侧上扬 | 往后贴 | 嘴角下垂 |
| 6 | 饿了 | 饿了 | 抬眼看人 | 内侧上扬 | 自然 | 舔嘴 |
| 7 | 犯困 | 困了 | 半闭 | 放松 | 下垂 | 闭合 |
| 8 | 睡着 | 睡着 | 闭眼 | 放松 | 摊开 | 闭合、放松 |
| 9 | 打哈欠 | 困了、刚醒 | 闭眼 | 放松 | 往后 | 张大、舌头卷起 |
| 10 | 闻东西 | 闻闻 | 半眯，往下看 | 平 | 往前垂 | 闭合、鼻子皱起 |
| 11 | 吃惊 | 被吓到、突然有人上线 | 睁很大 | 上扬 | 竖起 | 微张 |
| 12 | 吃饱满足 | 吃撑了 | 慢眨、半眯 | 放松 | 放松 | 微笑 |
| 13 | 害怕 | 打雷之类（先天特质） | 睁大、露出眼白 | 内侧上扬 | 平贴后脑 | 紧闭 |
| 14 | 兴奋 | 有人上线、开盲盒 | 睁大、亮 | 上扬 | 向外张 | 张开 |
| 15 | 咀嚼 | 吃饭 | 半眯 | 平 | 往前 | 上下嚼 |
| 16 | 舔鼻子 | 饿了、吃完 | 正常 | 平 | 自然 | 舌头舔过鼻子 |

**形态键清单**（3D 建模时做出来，名字照抄，左右分开的要分开做）

| 形态键 | 作用 |
|---|---|
| `eyeBlink_L` / `eyeBlink_R` | 上眼皮闭合（眨眼、睡觉） |
| `eyeSquint_L` / `eyeSquint_R` | 下眼皮上推，眯眼笑 |
| `eyeWide_L` / `eyeWide_R` | 睁大 |
| `eyeSad_L` / `eyeSad_R` | 外眼角下垂 |
| `browInnerUp` | 眉头内侧上扬（委屈、饿） |
| `browUp_L` / `browUp_R` | 整个眉毛上扬 |
| `jawOpen` | 张嘴（也可以用下颌骨骼） |
| `mouthSmile` | 嘴角上扬 |
| `mouthFrown` | 嘴角下垂 |
| `tongueOut` | 舌头伸出（喘气） |
| `tongueLick` | 舌头往上舔鼻子 |
| `noseWrinkle` | 鼻子皱起（闻东西） |
| `noseSniff` | 鼻孔张合 |
| `cheekPuff` | 脸颊鼓起（嚼东西） |
| `belly_full` | 刚吃饱，肚子鼓起（几小时后消下去） |
| `belly_fat` | 长期吃多，变胖 |
| `body_thin` | 偏瘦 |
| `age_puppy` | 整体变成 2 个月幼犬的比例（见第 4 节） |

---

## 4. 3D 模型规格

- **格式**：glTF 2.0（`.glb`），Y 轴向上，单位米，正面朝 +Z（glTF 的约定）。
- **面数**：狗 1 万到 2.5 万三角面。它在桌面上只有一两百像素，再多也看不出来，还拖慢速度。
- **拆分部件**：身体、左右眼球（带透明角膜，好出高光）、舌头、口腔和牙齿。眼皮能闭合，嘴能张开。
- **布线**：肩、肘、髋、膝、跗关节、脖子这些地方多加几圈线；耳朵至少分 4 到 5 段，方便甩；尾巴至少 6 段；肚子布线均匀，方便鼓起来。
- **幼犬和成年**：两者用同一套拓扑和 UV，顶点顺序一致。以成年为基础模型，把幼犬做成形态键 `age_puppy`，月龄就能连续变化。实在做不到的话，至少两者用同一套骨骼，再用骨骼缩放补。
- **毛发**：画在贴图里，用法线贴图表现毛流方向。不用真实毛发系统，桌面上实时跑太重。轮廓边缘可以加一圈薄薄的毛边面片，让剪影不那么硬。
- **贴图**：2048 分辨率，基础色、法线、粗糙度三张。
- **UV**：以后所有狗的品种共用一套 UV 布局；毛色变体只换贴图，不改模型。

---

## 5. 骨骼

所有狗的品种共用这一套骨骼，以后做猫再单独建一套。骨骼名字照抄，左右用 `_L` / `_R`。

| 部位 | 骨骼 |
|---|---|
| 根 | `root`（地面中心）、`hips` |
| 脊柱 | `spine_01`、`spine_02`、`spine_03`、`chest` |
| 肚子 | `belly`（呼吸和吃饱后的晃动） |
| 脖子和头 | `neck_01`、`neck_02`、`head`、`jaw` |
| 舌头 | `tongue_01` ~ `tongue_03` |
| 耳朵 | `ear_01_L` ~ `ear_04_L`，右边同理 |
| 眼睛 | `eye_L`、`eye_R`（转眼球） |
| 前腿 | `shoulder_L`、`upperarm_L`、`forearm_L`、`hand_L`、`paw_L` |
| 后腿 | `thigh_L`、`shin_L`、`foot_L`（跗关节以下）、`toe_L` |
| 尾巴 | `tail_01` ~ `tail_06` |

**挂点**（空骨骼，用来挂道具）：`mouth_socket`（叼纸条、叼球）、`collar_socket`（项圈）、`head_top_socket`（帽子）、`back_socket`（背上的小装饰）。

**要求**：
- 耳朵、尾巴、肚子这几组骨骼会在程序里加弹簧物理，蒙皮权重要过渡平滑，不能一动就折。
- 做一组简单的碰撞胶囊（头、胸、腰、四条腿），用来做拖拽和甩出去的物理效果。
- 骨骼做完先摆这几个姿势测试：坐、趴、抬前爪、扭头 90 度、尾巴翘到顶、耳朵甩到水平。关节处不能塌陷或穿模。

---

## 6. 动画清单

统一规则：30 帧每秒；原地动画（不带位移），位移由程序控制；循环动画首尾帧一致；姿势之间都要有过渡动画。

类型说明：**循环** 一直播；**单次** 播一遍；**过渡** 从一个姿势到另一个；**叠加层** 只动部分骨骼，可以和其他动画同时播。

| 动作 | 类型 | 时长约 | 用在 | 优先级 |
|---|---|---|---|---|
| 站立待机（含重心微晃） | 循环 | 4 秒 | 默认 | P0 |
| 走路 | 循环 | 1 秒 | 溜达、串门 | P0 |
| 小跑 | 循环 | 0.6 秒 | 开心、被呼唤 | P0 |
| 原地转身 | 单次 | 0.6 秒 | 换方向 | P0 |
| 站→坐 / 坐→站 | 过渡 | 各 0.8 秒 | 饿了、困了 | P0 |
| 坐着待机 | 循环 | 4 秒 | 饿了、困了 | P0 |
| 站→趴 / 趴→站 | 过渡 | 各 1 秒 | 无聊、吃撑 | P0 |
| 趴着待机 | 循环 | 4 秒 | 吃撑了 | P0 |
| 下巴搁爪子 | 循环 | 4 秒 | 无聊 | P1 |
| 趴→蜷睡 / 睡醒 | 过渡 | 各 1.5 秒 | 睡着 | P0 |
| 蜷着睡 | 循环 | 4 秒 | 睡着 | P0 |
| 做梦蹬腿 | 单次 | 2.5 秒 | 睡着时偶尔 | P1 |
| 低头吃饭 | 循环 | 1 秒 | 吃饭 | P0 |
| 低头闻地走 | 循环 | 1.4 秒 | 闻闻 | P1 |
| 邀玩（前身趴低屁股撅高） | 循环 | 1.2 秒 | 想玩 | P1 |
| 原地蹦一下 | 单次 | 0.45 秒 | 开心 | P1 |
| 抬一只前爪 | 过渡加循环 | 0.5 秒 + 循环 | 好奇 | P1 |
| 扒拉碗 | 单次 | 0.8 秒 | 饿了 | P1 |
| 打哈欠 | 单次 | 1.8 秒 | 困了、刚醒 | P1 |
| 伸懒腰 | 单次 | 2 秒 | 刚醒 | P1 |
| 抖毛 | 单次 | 1.2 秒 | 随机 | P2 |
| 后腿挠耳朵 | 单次 | 1.5 秒 | 随机 | P2 |
| 翻肚皮 | 过渡加循环 | 1 秒 + 循环 | 被摸时撒娇 | P2 |
| 被摸时往手上蹭 | 循环 | 2 秒 | 被抚摸 | P1 |
| 被拎起悬空（四肢下垂） | 循环 | 1 秒 | 鼠标拖拽 | P0 |
| 落地 | 单次 | 0.5 秒 | 被放下、被甩出去 | P0 |
| 吓一跳 | 单次 | 0.6 秒 | 突发事件 | P2 |
| 兴奋转圈 | 单次 | 1.2 秒 | 有人上线、开盲盒 | P1 |
| 叼纸条走路 | 循环 | 1 秒 | 带话 | P1 |
| 从盲盒里探头、爬出来 | 单次 | 3 秒 | 开盲盒 | P0 |
| 呼吸 | 叠加层 | 循环 | 一直 | P0 |
| 摇尾巴（慢、中、快三档） | 叠加层 | 循环 | 按情绪 | P0 |
| 耳朵抖一下 | 叠加层 | 0.3 秒 | 随机 | P1 |
| 叹气 | 叠加层 | 1.4 秒 | 无聊、委屈 | P1 |
| 歪头 | 叠加层 | 0.5 秒 | 好奇、饿了 | P1 |

眨眼、视线跟着鼠标、耳朵和尾巴的弹簧晃动、肚子鼓起来，都在程序里实时算，不用做成动画。

---

## 7. 道具

风格和狗保持一致（轻度风格化写实），每件 2000 三角面以内，贴图 1024。

| 道具 | 用途 | 要求 | 优先级 |
|---|---|---|---|
| 食盆 | 喂食；也是"呼唤"的入口 | 浅蓝陶瓷，能看到碗里面 | P0 |
| 狗粮颗粒 | 碗里的粮一粒粒变少 | 单颗模型，做 2 到 3 种形状 | P0 |
| 盲盒 | 开盲盒仪式 | 圆角纸盒，有透气孔和布绑带；盖子单独一块能掀开；不要商标和文字 | P0 |
| 粮袋 | 拖到碗上倒粮 | 袋口能倾斜 | P1 |
| 零食 | 远程投喂 | 骨头形饼干 | P1 |
| 纸条 | 带话 | 折起来能叼在嘴里，另做一个展开状态 | P1 |
| 狗窝 | 没人在线时它待的家 | 圆形软垫窝 | P1 |
| 项圈和名牌 | 显示名字 | 名牌上留空白，名字由程序写上去 | P1 |
| 口哨 | 呼唤的另一种入口 | 小号银色 | P1 |
| 球 | 甩出去它去追 | 网球 | P1 |
| 绳结玩具 | 玩耍 | 两头打结 | P2 |
| 水碗 | 生活感 | 和食盆一套 | P2 |

---

## 8. 场景

宠物生活在真实桌面上，大多数时候不需要场景：任务栏顶边就是地面，窗口顶边就是台子，只要一圈柔和的接触阴影。需要做的是下面这几个：

| 场景 | 内容 | 优先级 |
|---|---|---|
| 开盲盒 | 盒子放在中间，组里每个人各点一下；盒子抖动、绑带松开、盖子掀开，幼犬探头再爬出来。背景简单，一点暖光和少量飘落的小纸屑就够 | P0 |
| 狗窝角落 | 没人在线时它待的地方：狗窝、小毯子、食盆，房间一角，暖色 | P1 |
| 远程小窗 | 不在你这儿时，小窗里看它在别人那儿干嘛；直接复用狗窝角落的背景 | P1 |
| 串门进出 | 从屏幕边走出去、从另一边走进来，靠动画实现，不用建模 | P1 |
| 打工 | 二期再做，先留位 | P2 |

**灯光**：统一一套柔和三点光，不烘焙环境光，这样放在任何壁纸上都不突兀。

---

## 9. 给 GPT 的提示词（直接复制）

### 9.1 角色总描述（每条提示都带上）

```
A beagle character for a desktop pet. Lightly stylized realism: anatomically accurate beagle with slightly larger, soft, expressive eyes; cute but not cartoonish; no outlines; short dense coat with visible fur direction. Classic tricolor: a black saddle from behind the shoulders to the base of the tail; warm tan head, ears, shoulders and outer thighs; a white blaze running from between the eyes down to a white muzzle; white chin, chest, belly, lower legs, and a white tail tip covering about the last quarter of the tail. Long, wide, soft ears set low, hanging close to the cheeks, with rounded tips. Black nose, dark brown eyes with a gentle, pleading look. Tail carried up with a slight curve, not curled over the back. Four legs, natural dog anatomy, never standing upright, no clothing.
```

### 9.2 A 成年三视图

```
[角色总描述] Character turnaround sheet of this beagle as an adult (12 months old). Orthographic views on one sheet: front, left side, back, and three-quarter front. Neutral standing pose, all four legs clearly visible and separated, head level, tail relaxed. Plain light grey background, soft even studio lighting, no cast shadows, no props, no text. Same scale in every view.
```

### 9.3 B 幼犬三视图

```
[角色总描述] Character turnaround sheet of the same beagle as an 8-week-old puppy. Big head relative to the body, eyes set slightly lower on the face, short muzzle, oversized paws, round belly, short legs, ears long relative to the head, slightly darker tan on the top of the head and on the ears. Orthographic front, left side, back and three-quarter front views. Neutral standing pose with all four legs visible. Plain light grey background, even lighting, no shadows, no text. Keep exactly the same character and markings as the reference image.
```

### 9.4 C 毛色分布图

```
[角色总描述] Flat color map of the same adult beagle: top view and left side view, standing. Flat even lighting with no shading, crisp boundaries between the black, tan and white areas so it can be used as a texture reference. Plain light grey background, no text. Keep exactly the same markings as the reference image.
```

### 9.5 D 表情表

```
[角色总描述] Expression sheet of the same beagle puppy, head and shoulders, three-quarter front view, 4x4 grid, identical lighting in every cell. Row 1: neutral; happy panting with tongue out; big happy squint; curious head tilt with ears lifted at the base. Row 2: sad with ears pulled back and watery pleading eyes; hungry looking up while licking its lips; sleepy half-closed eyes; asleep with eyes closed. Row 3: yawning wide with tongue curled; sniffing with the nose wrinkled; surprised with eyes wide; content after eating with soft half-closed eyes. Row 4: scared with ears flat and whites of the eyes showing; excited with mouth open; chewing; licking its nose. Plain light grey background, no text. Keep the face and markings identical in every cell.
```

### 9.6 E 月龄对比

```
[角色总描述] Side view lineup of the same beagle at 2, 4, 6, 9 and 12 months old, standing in a row facing right, drawn to the same scale on a plain light grey background. Show realistic growth: at 2 months a big head, big paws and round belly; at 6 months long legs and a slightly lanky body; at 12 months a balanced adult with a deeper chest and longer muzzle. Even lighting, no text.
```

### 9.7 F 细节特写

```
[角色总描述] Detail sheet of the same beagle: close-ups of the eye, the nose, the inside of the ear, a front paw from below showing the paw pads, and the white tail tip. Plain light grey background, even lighting, no text.
```

### 9.8 G 毛色变体

```
[角色总描述] The same beagle puppy shown in four coat variants side by side, same pose and lighting: classic tricolor, red and white, lemon and white (very pale yellow and white), chocolate tricolor (the black areas replaced with chocolate brown). Plain light grey background, no text.
```

### 9.9 H 关键姿势

```
[角色总描述] Pose sheet of the same beagle puppy, side or three-quarter views: sitting; lying down sphinx-style; chin resting on its front paws; curled up asleep; play bow with front down and rear up; one front paw raised; head tilt; scratching its ear with a hind leg; stretching with front legs forward and rear up; lying on its back showing the belly; dangling in the air as if being lifted, legs hanging loosely. Plain light grey background, even lighting, no text.
```

### 9.10 I 道具表

```
Prop sheet in a lightly stylized realistic style matching a cute beagle desktop pet: a pale-blue ceramic dog bowl filled with kibble; the same bowl empty; a kibble bag; three individual kibble pieces in close-up; a bone-shaped dog biscuit; a folded paper note and the same note unfolded; a tennis ball; a rope toy knotted at both ends; a round plush dog bed; a red collar with a blank round name tag; a small silver whistle. Plain light grey background, soft lighting, no text, no logos.
```

### 9.11 J 盲盒

```
A cute gift box used to reveal a new puppy, lightly stylized realistic style: a rounded cardboard box with small air holes and a soft fabric ribbon. Three states side by side: closed with the ribbon tied; ribbon untied; lid lifting with the same beagle puppy peeking out. Plain light grey background, soft warm lighting, no text, no logos.
```

---

## 10. 验收清单

**设定图**
- [ ] 四条腿分开、全部可见（三视图）
- [ ] 耳朵够长，往前拉几乎碰到鼻尖；耳尖是圆的
- [ ] 额头白纹和白口鼻连在一起；尾尖是白的
- [ ] 每张图里的花色都和 A 一致
- [ ] 幼犬和成年的差别在比例上（头、口鼻、腿、爪子），不只是大小
- [ ] 表情表缩到 150 像素宽，16 个表情还能一眼分清

**3D 模型**
- [ ] `.glb` 格式，Y 向上，单位米，正面朝 +Z
- [ ] 三角面 1 万到 2.5 万
- [ ] 眼球、舌头单独拆开；眼皮能闭合，嘴能张开
- [ ] 幼犬和成年同一套拓扑和 UV，`age_puppy` 形态键拖动过程中不穿模
- [ ] 第 3 节的形态键全都有，名字一致

**骨骼和动画**
- [ ] 骨骼名字和第 5 节一致，挂点都在
- [ ] 第 5 节的六个测试姿势不塌、不穿模
- [ ] 循环动画首尾不跳；原地动画不带位移
- [ ] 叠加层动画只动对应的骨骼
