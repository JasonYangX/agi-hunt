/* ============================================================
 * AGI Hunt — SEO 元数据与关键词映射
 * 站点内每一条 URL 的 title / description / H1 都由此计算。
 * 浏览器端（app.js）与构建期（build.mjs）共用同一份规则，
 * 避免预渲染页面与客户端导航出现元信息漂移。
 *
 * 关键词分层：
 *   分类页   —— 承载「品类词」，如「AI 编程工具」「MCP 服务器」
 *   合集页   —— 承载「修饰词 + 品类」，如「免费 AI 工具」「开源 AI 工具」
 *   详情页   —— 承载「品牌词 + 意图」，如「ChatGPT 官网入口与价格」
 *   开发者工具 —— 承载高意图工具词，如「JSON 格式化」「JWT 解析」
 * ============================================================ */
(function (root) {
  'use strict';

  var SITE = 'https://www.agihunt.cn';
  var BRAND = 'AGI Hunt';

  var PRICE = { free: '免费', freemium: '免费增值', paid: '付费' };
  var PLATFORM = {
    web: 'Web', mac: 'macOS', win: 'Windows', ios: 'iOS',
    android: 'Android', api: 'API', self: '自托管'
  };

  /* ---------------- 分类词：一个分类只主打一个主词 ----------------
   * title / desc / h1 参与渲染；intro 与 pick 为分类导语与选型要点，
   * 当前版本不渲染（页面只保留工具列表），保留作内容储备。
   */
  var CAT_SEO = {
    chat: {
      h1: 'AI 对话助手',
      title: 'AI 对话工具推荐：{n} 款大模型助手对比与官网入口',
      desc: '通用对话工具合集，共 {n} 款：ChatGPT、Claude、Gemini、DeepSeek、Kimi、豆包等，覆盖长文档、推理、多模态、角色互动与企业问答，附定价与官网入口。',
      intro: '通用对话工具的能力差距正在收窄，真正的差异在上下文长度、文件解析、联网检索与价格。下面按「日常问答 / 长文档 / 编程推理 / 国内直连」四类场景排布，先明确用途再选型，比追新版本更有效。',
      pick: ['日常问答与写作：ChatGPT、Claude、豆包', '长文档与资料整理：Kimi、通义千问', '国内网络环境与中文语境：DeepSeek、腾讯元宝、智谱清言']
    },
    writing: {
      h1: 'AI 写作工具',
      title: 'AI 写作工具推荐：润色、改写与文案生成 {n} 款对比',
      desc: 'AI 写作与润色工具合集，共 {n} 款：Grammarly、DeepL Write、秘塔写作猫、Jasper 等，覆盖语法校对、学术润色、改写降重、多语翻译与营销文案批量生成。',
      intro: '写作类工具的分水岭是「改」还是「写」：Grammarly、QuillBot、DeepL Write 强在逐句润色与语体转换，Jasper、Copy.ai 更偏营销文案的批量产出。中文长文场景下，通用大模型往往比专用写作工具更灵活。',
      pick: ['英文语法与学术润色：Grammarly、DeepL Write', '中文改写与降重：秘塔写作猫', '营销文案批量化：Jasper、Copy.ai']
    },
    image: {
      h1: 'AI 绘画与图像生成',
      title: 'AI 绘画工具推荐：文生图与图生图 {n} 款对比（含免费）',
      desc: 'AI 绘画与图像生成工具合集，共 {n} 款：Midjourney、Ideogram、即梦 AI、ComfyUI 等，覆盖文生图、图生图、局部重绘与放大，标注定价与商用注意事项。',
      intro: '文生图的可控性取决于三件事：是否支持参考图与局部重绘、能否保持风格一致、以及商用授权范围。Midjourney 强在审美下限，ComfyUI 强在流程可控，国内产品则在访问稳定性上占优。',
      pick: ['追求出图质量：Midjourney、Ideogram（擅长画面文字）', '需要工作流与批量：ComfyUI（本地、免费）', '国内直连与中文提示词：即梦 AI、通义万相']
    },
    video: {
      h1: 'AI 视频生成',
      title: 'AI 视频生成工具：文生视频、数字人与剪辑 {n} 款对比',
      desc: 'AI 视频工具合集，共 {n} 款：可灵 AI、Runway、Veo、HeyGen、剪映等，覆盖文生视频、数字人口播与剪辑后期，按用途与价格对比。',
      intro: 'AI 视频分三条路线：文生视频（Runway、可灵、Veo）、数字人口播（HeyGen）、剪辑后期增强（Descript、剪映）。三者的评估指标完全不同——前者看镜头稳定性与时长，后者看口型同步与素材管理。',
      pick: ['文生视频与镜头控制：可灵 AI、Runway、Veo', '数字人与多语言口播：HeyGen', '剪辑与字幕：剪映、Descript']
    },
    audio: {
      h1: 'AI 音频工具',
      title: 'AI 配音与音乐生成：语音合成、转录 {n} 款工具对比',
      desc: 'AI 音频工具合集，共 {n} 款：ElevenLabs、Suno、Whisper、讯飞听见等，覆盖语音合成、音乐生成、转录与多语言配音，标注是否支持本地运行。',
      intro: '音频工具按输入输出可分四类：文本转语音（ElevenLabs、Murf）、音乐生成（Suno、Udio）、语音转文字（Whisper、讯飞听见）、以及多语言配音。选型先看语种与音色授权，再看是否需要时间轴对齐。',
      pick: ['多语言配音与音色克隆：ElevenLabs', '中文转录与会议记录：讯飞听见', '本地离线转录：Whisper']
    },
    code: {
      h1: 'AI 编程工具',
      title: 'AI 编程工具推荐：Cursor、Copilot 等 {n} 款对比',
      desc: 'AI 编程工具合集，共 {n} 款：Cursor、GitHub Copilot、Claude Code、Windsurf、v0 等，覆盖代码补全、仓库级重构与应用生成，按使用形态分类对比。',
      intro: 'AI 编程工具已经分成三种形态：IDE 内的补全与重构（Copilot、Cursor、Windsurf）、终端里的自主代理（Claude Code）、以及从自然语言直接生成应用（v0、bolt.new、Lovable）。三者不可互相替代，按任务粒度选择。',
      pick: ['日常补全与仓库级修改：Cursor、GitHub Copilot、Windsurf', '多文件重构与命令行任务：Claude Code', '从描述生成可部署页面：v0、bolt.new、Lovable']
    },
    agent: {
      h1: 'AI Agent 与自动化',
      title: 'AI Agent 工具：工作流编排与浏览器自动化 {n} 款对比',
      desc: 'AI Agent 与自动化工具合集，共 {n} 款：n8n、Dify、Manus、Browser Use、LangChain 等，覆盖可视化工作流、浏览器操作与自主执行框架。',
      intro: 'Agent 工具的差异不在模型，而在执行环境与失败恢复：n8n、Dify 提供可视化编排与自托管，Manus、Browser Use 直接操作浏览器，LangChain 则是给开发者的代码框架。先确认你需要的是一套流程，还是一个能自己试错的执行者。',
      pick: ['可视化工作流与自托管：n8n、Dify', '浏览器操作与通用任务：Manus、Browser Use', '二次开发与编排框架：LangChain']
    },
    skill: {
      h1: 'Agent Skills 技能库',
      title: 'Agent Skills 技能库：SKILL.md 规范与 {n} 个入口',
      desc: 'Agent Skills 技能生态合集，共 {n} 个入口：Anthropic 官方技能库、Agent Skills 开放标准、SkillsMP 与 Claude Market 等，说明 SKILL.md 的结构与分发方式。',
      intro: 'Agent Skills 是近两年形成的一层新生态：用 SKILL.md 描述能力，由客户端按需加载。目前的分歧在分发方式——官方仓库、社区市场，还是直接引用 Git 仓库。这一页把规范、目录与市场入口放在一处。',
      pick: ['了解规范本身：Agent Skills 标准、Anthropic Skills', '找现成技能：SkillsMP、ClaudeSkills.info', '在客户端内安装：Claude Market']
    },
    mcp: {
      h1: 'MCP 服务器与目录',
      title: 'MCP 服务器推荐：{n} 个服务目录与官方参考实现',
      desc: 'MCP 服务器与目录合集，共 {n} 个：Model Context Protocol 官方规范、GitHub MCP Server、Playwright MCP、Smithery、MCP.so 等，按实现与目录分类。',
      intro: 'MCP（Model Context Protocol）解决的是「模型如何安全地调用外部工具与数据」。落地时通常需要两样东西：一个可用的服务器，和一个能发现服务器的目录。下面区分官方实现、社区目录与托管服务三类。',
      pick: ['官方规范与参考实现：Model Context Protocol、GitHub MCP Server', '找现成服务器：Smithery、MCP.so、PulseMCP', '浏览器与自动化：Playwright MCP、Zapier MCP']
    },
    dsh: {
      h1: 'DSH 插件生态',
      title: 'DSH 插件：DeepSeek Harness 市场与 {n} 个扩展',
      desc: 'DSH（DeepSeek Harness）插件合集，共 {n} 个：官方仓库、DSH Plugin Hub、dshfind、awesome-dsh-plugin 与精选扩展，附安装方式与安全审查建议。',
      intro: 'DSH（DeepSeek Harness）是 DeepSeek 开源的 Agent 运行框架，插件化架构让模型、工具与会话都可替换。生态仍在早期，插件来源分散在 npm、GitHub 与社区市场，安装前建议先核对 manifest 与权限。',
      pick: ['先装本体：DeepSeek Harness（npx 一行启动）', '找插件：DSH Plugin Hub、dshfind、awesome-dsh-plugin', '装前审查：Safer DSH Market']
    },
    learn: {
      h1: 'AI 学习资源',
      title: 'AI 学习路线：{n} 门免费课程与实战平台推荐',
      desc: 'AI 学习资源合集，共 {n} 门：DeepLearning.AI、fast.ai、动手学深度学习、Kaggle Learn、飞桨 AI Studio 等，按入门、实战与系统教材分层。',
      intro: 'AI 学习的路径分歧在于「先数学还是先动手」。对多数从业者，先用现成框架跑通一个项目，再回补梯度与注意力机制，效率更高。这一页按课程深度分三层：零基础入门、框架实战、需要线性代数基础的系统课程。',
      pick: ['零基础与概念建立：Google ML Crash Course、Generative AI for Beginners', '动手实战：DeepLearning.AI、Kaggle Learn、飞桨 AI Studio', '系统性教材：动手学深度学习、fast.ai']
    },
    search: {
      h1: 'AI 搜索与研究',
      title: 'AI 搜索工具：深度研究、文献综述与资料问答 {n} 款',
      desc: 'AI 搜索与研究工具合集，共 {n} 款：Perplexity、秘塔 AI 搜索、Consensus、Elicit、NotebookLM 等，覆盖联网问答、文献综述与自有资料检索。',
      intro: 'AI 搜索的差别在检索范围与引用可核查性：Perplexity、秘塔偏通用联网问答，Consensus、Elicit 限定在论文库，NotebookLM 只在你上传的资料内作答。做研究时，能否回溯到原文比答案流畅度更重要。',
      pick: ['通用联网问答：Perplexity、秘塔 AI 搜索', '学术文献与综述：Consensus、Elicit、Semantic Scholar', '自有资料问答：NotebookLM']
    },
    design: {
      h1: 'AI 设计工具',
      title: 'AI 设计工具：UI 生成、抠图与品牌素材 {n} 款对比',
      desc: 'AI 设计工具合集，共 {n} 款：Figma AI、Canva Magic Studio、Uizard、remove.bg、Recraft 等，覆盖 UI 生成、营销物料、抠图与矢量资产。',
      intro: '设计类 AI 工具可按交付物区分：UI 稿（Figma AI、Uizard）、营销物料（Canva、稿定）、位图处理（remove.bg）、矢量与品牌资产（Recraft）。多数团队的实际瓶颈不是生成，而是结果能否进入现有设计系统。',
      pick: ['UI 与原型：Figma AI、Uizard', '营销物料与模板：Canva Magic Studio、稿定 AI', '抠图与矢量资产：remove.bg、Recraft']
    },
    productivity: {
      h1: 'AI 办公工具',
      title: 'AI 办公工具：PPT 生成、会议纪要与文档协作 {n} 款',
      desc: 'AI 办公工具合集，共 {n} 款：Microsoft 365 Copilot、飞书智能伙伴、Gamma、Otter.ai 等，覆盖文档协作、演示生成、会议纪要与知识管理。',
      intro: '办公场景的 AI 价值集中在三件事：把会议变成纪要、把大纲变成演示、把散落文档变成可检索的知识。前两者已相对成熟，第三者的效果高度依赖权限与数据结构。',
      pick: ['会议记录与转写：Otter.ai、飞书智能伙伴', '演示与大纲：Gamma、Tome、Napkin AI', '文档与知识库：Microsoft 365 Copilot、Mem']
    },
    model: {
      h1: '大模型 API 与本地部署',
      title: '大模型 API 与本地部署：{n} 个推理服务平台对比',
      desc: '大模型 API 与本地部署工具合集，共 {n} 款：Hugging Face、OpenRouter、Groq、Ollama、LM Studio、硅基流动等，对比托管、推理与本地运行。',
      intro: '模型服务分三层：模型托管与下载（Hugging Face、魔搭）、推理 API 与路由（OpenRouter、Together、Groq、硅基流动）、本地运行（Ollama、LM Studio）。选型先看延迟与上下文价格，再看是否需要数据不出境。',
      pick: ['多模型统一接口：OpenRouter', '低延迟推理：Groq、硅基流动', '本地运行与隐私：Ollama、LM Studio']
    }
  };

  /* ---------------- 开发者工具：高意图工具词，主词前置 ---------------- */
  var DEV_SEO = {
    json: {
      title: 'JSON 格式化与校验：JSONC 宽松模式、大整数不丢精度',
      desc: '在线 JSON 格式化与校验：保留超大整数与浮点字面量，重复键给出告警，解析失败精确到行列。支持 JSONC 注释、尾逗号与单引号，输入输出均带行号，可一键压缩或切换树视图。纯前端运行，接口返回与配置不会上传。',
      lead: '使用自写扫描器而非 JSON.parse，9007199254740993 这类超出双精度的整数会原样保留，重复键不再静默覆盖。出错时直接给出第几行第几列并附修改建议；粘贴带注释或尾逗号的配置时可勾选「宽松（JSONC）」，状态行会列出被忽略的每一处。',
      use: ['排查接口返回的压缩 JSON，定位括号、逗号或引号错误',
        '对比字段顺序不一的 JSON：一键键排序，树视图里点节点复制 JSONPath',
        '处理含 64 位 ID 或大额金额的返回体，避免精度丢失改坏数据']
    },
    base64: {
      title: 'Base64 在线编码解码：支持中文与 UTF-8',
      desc: 'Base64 在线编码与解码，中文与 emoji 按 UTF-8 处理，非法输入会直接提示。常用于 Data URI、请求头与接口调试，内容不出本机。',
      lead: '编码与解码各一个入口，结果实时输出并可一键复制；粘贴的字符串不合法时会提示，而不是给出乱码。',
      use: ['解析 Basic Auth 请求头里的编码串', '为 SVG 或短文本生成 Data URI', '调试接口中传输的中文编码结果']
    },
    url: {
      title: 'URL 编码解码：转义、还原与参数拆解',
      desc: 'URL 编码解码工具：实时转义与还原，另可把查询参数按 key-value 拆开，并提示非法的百分号编码。适合调试带中文与空格参数的链接。',
      lead: '编码走 encodeURIComponent，解码自动还原百分号序列；「拆解查询参数」会把链接拆成键值列表，逐项核对更省事。',
      use: ['调试带中文参数的分享链接', '还原被多次 encode 的查询字符串', '拆解 UTM 参数与嵌套 query']
    },
    hash: {
      title: 'SHA-256 在线哈希：SHA-1、SHA-512 本地计算',
      desc: '在线计算 SHA-256、SHA-1、SHA-512 摘要，随输入实时输出十六进制结果。基于 Web Crypto 在本地计算，文本不会离开浏览器。',
      lead: '选择算法后随输入实时计算，摘要可一键复制；依赖 Web Crypto，需在 HTTPS 或 localhost 下使用，不支持 MD5。',
      use: ['校验文本内容的 SHA-256 是否与发布方一致', '为接口签名准备 body 的摘要', '比对两次构建产物的哈希']
    },
    jwt: {
      title: 'JWT 在线解析：解码 Header 与 Payload',
      desc: 'JWT 在线解析：按 Header 与 Payload 分区展示，把 iss、sub、aud、exp 译成可读字段并标注是否过期。仅解码，不校验签名。',
      lead: '粘贴三段式令牌即可展开结构，签发时间与过期时间会换算成本地时间；签名有效性仍需在服务端验证。',
      use: ['排查 401：确认 token 是否已过期', '核对 Payload 中的 sub、aud 与签发方', '检查令牌是否被截断或结构不完整']
    },
    uuid: {
      title: 'UUID 在线生成：批量 v4 标识符',
      desc: '批量生成 UUID v4，单次最多 100 条，结果按行排列、可整体复制。适用于数据库主键、幂等键与测试数据，生成过程不联网。',
      lead: '指定数量后一次生成，结果按行排列，可直接粘进 SQL 或 JSON；随机源由浏览器提供，不经过服务器。',
      use: ['为数据库主键批量生成 v4 ID', '构造幂等键与请求追踪 ID', '生成测试用的假数据']
    },
    timestamp: {
      title: 'Unix 时间戳转换：秒、毫秒与日期互转',
      desc: 'Unix 时间戳转换：秒级与毫秒级时间戳、日期之间双向互转，并给出当前时间对照。适合排查日志时间与跨时区排期。',
      lead: '上方显示当前时间与对应时间戳；下方在时间戳与日期之间互转，秒级结果可单独复制。',
      use: ['把日志里的 10 位 / 13 位时间戳转成可读时间', '核对跨时区活动的开始时间', '生成未来某个时间点的时间戳']
    },
    color: {
      title: '颜色转换：HEX、RGB、HSL 在线互转',
      desc: 'HEX、RGB、HSL 颜色格式互转，实时预览并生成一组明度阶梯，方便挑悬浮态与边框色。适合从设计稿取色后落到 CSS 变量。',
      lead: '输入任一格式，其余格式同步换算；明度阶梯按固定步长展开，可直接点选复制。',
      use: ['把设计稿的 HEX 值转成 rgb() 写进 CSS', '用明度阶梯挑悬浮态与边框色', '统一品牌色的深浅梯度']
    },
    regex: {
      title: '正则表达式在线测试：匹配高亮与分组',
      desc: '正则表达式在线测试：匹配片段即时高亮并标出位置，捕获分组按 $1、$2 列出。适合验证邮箱、URL 与日志解析规则。',
      lead: '表达式无需写斜杠，输入即匹配；结果区给出匹配位置与分组内容，便于确认提取范围。',
      use: ['验证邮箱、手机号与 URL 的匹配规则', '调试日志采集的正则与捕获分组', '核对分组提取的位置是否符合预期']
    },
    text: {
      title: '在线字数统计：字数、行数与 Token 估算',
      desc: '统计含空格与不含空格的字符数、汉字与西文词数、行数与段落数，并给出启发式 Token 估算与阅读时长。',
      lead: '中英文分开计数，含空格与不含空格的字符数分别给出；Token 为启发式估算，实际用量以具体模型的分词器为准。',
      use: ['估算提示词占用的 Token 量', '统计文章字数是否达到平台要求', '检查多行文本的行数与段落数']
    },
    markdown: {
      title: 'Markdown 在线预览：边写边渲染',
      desc: 'Markdown 在线预览与编辑：左侧书写、右侧即时渲染，适合在发布前检查标题层级、表格与代码块语法。内容仅保存在当前标签页。',
      lead: '输入即渲染，适合边改边对照；内容只停留在当前标签页，刷新即清除。',
      use: ['预览 README 与文档的渲染效果', '检查表格与代码块语法是否正确', '在发布前核对标题层级']
    },
    diff: {
      title: '文本对比：逐行差异高亮',
      desc: '逐行比对两段文本，高亮新增与删除并给出变动行数统计。适合核对配置变更、文案版本与接口返回，对比在本地完成。',
      lead: '粘贴原始文本与对比文本后点「开始对比」，差异按行着色，顶部汇总变动行数。',
      use: ['对比两版配置文件的差异', '核对文案改动的具体位置', '比较两次接口返回的 JSON 文本']
    }
  };

  /* ---------------- 合集页：修饰词 × 品类，承接中长尾 ---------------- */
  var HUBS = [
    {
      slug: 'free', tag: '免费', name: '免费 AI 工具',
      title: '免费 AI 工具合集：{n} 款可长期使用的产品',
      desc: 'AGI Hunt 收录的 {n} 款免费 AI 工具：含完全免费与提供稳定免费额度的产品，标注定价模式与平台，可直接跳转官网。',
      intro: '这里的「免费」指有可持续的免费额度或完全免费，而非仅限试用期。其中既有可本地运行的开源项目，也有提供每日额度的在线服务；额度政策会变，长期使用前请以官网为准。'
    },
    {
      slug: 'open-source', tag: '开源', name: '开源 AI 工具',
      title: '开源 AI 工具：{n} 个可自托管与二次开发的项目',
      desc: '{n} 个开源 AI 项目与开放标准：覆盖模型运行、Agent 框架、MCP 服务与技能库，标注仓库入口与自托管方式。',
      intro: '开源的价值在于可审计、可自托管与可二次开发，代价是部署与维护成本。这一页收录的 {n} 个项目多可本地运行，适合对数据出境敏感或需要深度定制的团队。'
    },
    {
      slug: 'chinese', tag: '中文', name: '中文 AI 工具',
      title: '中文 AI 工具：{n} 款适配中文语料的产品',
      desc: '{n} 款中文优先的 AI 工具：对中文长文本、公文语体与本地化场景做了优化，含国内可直接访问的产品与开源中文模型生态。',
      intro: '中文语境下的差异不只在界面翻译，更在语料、分词与合规。这一页的 {n} 款产品对中文长文本、公文语体与本地化表达处理更稳，适合内容、教育与政企场景。'
    },
    {
      slug: 'mcp', tag: 'MCP', name: 'MCP 服务器',
      title: 'MCP 服务器：{n} 个实现、目录与托管服务',
      desc: '{n} 个 MCP 相关入口：官方规范与参考实现、社区目录、浏览器与 SaaS 集成，说明 Model Context Protocol 的接入方式。',
      intro: 'MCP 服务器是把模型连接到文件、数据库与 SaaS 的适配层。这一页汇总 {n} 个实现与目录，按「官方参考实现 / 社区目录 / 托管服务」区分，便于先选来源再接入。'
    },
    {
      slug: 'dsh', tag: 'DSH', name: 'DSH 插件',
      title: 'DSH 插件：{n} 个市场、目录与扩展入口',
      desc: '{n} 个 DSH（DeepSeek Harness）插件入口：官方仓库、插件市场、目录与精选扩展，附安装方式与权限审查建议。',
      intro: 'DSH 插件生态仍在早期，条目分散在 npm、GitHub 与社区市场。这一页把 {n} 个入口按「市场 / 目录 / 单个插件」归类，便于先找来源再安装。'
    },
    {
      slug: 'local', tag: '本地部署', name: '本地部署 AI 工具',
      title: '本地部署 AI 工具：{n} 款离线运行方案',
      desc: '{n} 款可本地部署的 AI 工具：覆盖本地推理、模型管理与可视化工作流，适合对数据不出境与离线使用有要求的场景。',
      intro: '本地部署的核心约束是显存与内存，而非模型数量。这一页的 {n} 款工具覆盖本地推理、模型管理与可视化工作流，先在消费级显卡上跑通再考虑扩容，通常更划算。'
    }
  ];

  function priceLabel(p) { return PRICE[p] || p || ''; }
  function platformLabel(list) {
    return (list || []).map(function (p) { return PLATFORM[p] || p; }).join('、');
  }

  /* 标题宽度：中日韩字符按 2 计，西文按 1 计。
   * 按字符数判断会低估中文标题的实际像素宽度——30 个汉字的标题会被 SERP 截掉后半句。 */
  function width(s) {
    var n = 0;
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      n += code >= 0x2e80 && code <= 0xffef ? 2 : 1;
    }
    return n;
  }
  /* 品牌后缀放得下才加，放不下就只留主标题，避免被截断成「…— AGI H」 */
  function withBrand(base) {
    var full = base + ' — ' + BRAND;
    return width(full) <= 62 ? full : base;
  }
  function catName(id) {
    var cats = (root.AGI && root.AGI.CATEGORIES) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].name;
    return '';
  }
  function tools() { return (root.AGI && root.AGI.TOOLS) || []; }
  function devtools() { return (root.AGI && root.AGI.DEVTOOLS) || []; }
  function catCount(id) { return tools().filter(function (t) { return t.cat === id; }).length; }
  function tagCount(tag) { return tools().filter(function (t) { return t.tags.indexOf(tag) >= 0; }).length; }
  function fill(str, n) { return String(str).replace(/\{n\}/g, String(n)); }
  function hubList() { return HUBS.slice(); }
  function hubBySlug(slug) {
    for (var i = 0; i < HUBS.length; i++) if (HUBS[i].slug === slug) return HUBS[i];
    return null;
  }

  /* 规范路径：始终以 / 结尾，与静态目录结构一致 */
  function canonical(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': return '/category/' + ctx.cat.id + '/';
      case 'tool': return '/tool/' + ctx.tool.id + '/';
      case 'dev': return '/dev/' + ctx.dev.id + '/';
      case 'devIndex': return '/dev/';
      case 'tag': return '/tag/' + ctx.tag.slug + '/';
      case 'about': return '/about/';
      case 'favorites': return '/favorites/';
      case 'notfound': return '/404.html';
      default: return '/';
    }
  }

  /* 页面 H1：与 title 不同，避免两处重复同一串词 */
  function h1(ctx) {
    ctx = ctx || { kind: 'home' };
    if (ctx.kind === 'category') {
      var c = CAT_SEO[ctx.cat.id];
      return c && c.h1 ? c.h1 : ctx.cat.name + ' AI 工具';
    }
    if (ctx.kind === 'tag') return ctx.tag.name;
    if (ctx.kind === 'tool') return ctx.tool.name;
    if (ctx.kind === 'dev') return ctx.dev.name;
    if (ctx.kind === 'devIndex') return '开发者工具箱';
    if (ctx.kind === 'about') return '关于 ' + BRAND;
    return '';
  }

  function title(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': {
        var c = CAT_SEO[ctx.cat.id];
        if (c) return withBrand(fill(c.title, catCount(ctx.cat.id)));
        return withBrand(ctx.cat.name + ' AI 工具推荐 · ' + catCount(ctx.cat.id) + ' 个可用选择');
      }
      case 'tag': {
        return withBrand(fill(ctx.tag.title, tagCount(ctx.tag.tag)));
      }
      case 'tool': {
        var t = ctx.tool;
        var head = t.featured ? t.name + ' 官网入口与价格' : t.name + ' 是什么';
        var withTag = head + '：' + t.tagline;
        /* 依次尝试：主标题+一句话 > 主标题，任一能带品牌且不超宽就采用 */
        if (width(withTag + ' — ' + BRAND) <= 62) return withTag + ' — ' + BRAND;
        if (width(head + ' — ' + BRAND) <= 62) return head + ' — ' + BRAND;
        return width(withTag) <= 60 ? withTag : head;
      }
      case 'dev': {
        var d = DEV_SEO[ctx.dev.id];
        if (d) return withBrand(d.title);
        return withBrand(ctx.dev.name + '在线工具 · ' + ctx.dev.desc);
      }
      case 'devIndex':
        return withBrand('在线开发者工具 ' + devtools().length + ' 款：JSON、Base64、JWT、正则');
      case 'about':
        return '关于 ' + BRAND + ' · 收录标准与数据说明';
      case 'favorites':
        return '我的收藏 — ' + BRAND;
      case 'notfound':
        return '页面不存在 — ' + BRAND;
      default:
        return withBrand('AI 工具导航：' + tools().length + ' 款精选工具与 ' + devtools().length + ' 款开发者工具');
    }
  }

  function description(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': {
        var c = CAT_SEO[ctx.cat.id];
        if (c) return fill(c.desc, catCount(ctx.cat.id));
        var list = tools().filter(function (t) { return t.cat === ctx.cat.id; });
        var names = list.slice(0, 5).map(function (t) { return t.name; }).join('、');
        return ctx.cat.desc + '。收录 ' + list.length + ' 个' + ctx.cat.name +
          '方向的工具，如 ' + names + ' 等；可按定价与标签进一步筛选，附官网直达入口。';
      }
      case 'tag':
        return fill(ctx.tag.desc, tagCount(ctx.tag.tag));
      case 'tool': {
        var t = ctx.tool;
        return t.desc + ' 分类：' + catName(t.cat) + '；定价：' + priceLabel(t.pricing) +
          '；平台：' + platformLabel(t.platforms) + '；收录于 ' + t.added + '。';
      }
      case 'dev': {
        var d = DEV_SEO[ctx.dev.id];
        if (d) return d.desc;
        return ctx.dev.desc + '。纯浏览器实现，无需登录与上传，输入内容不离开本机，断网可用。';
      }
      case 'devIndex':
        return devtools().length + ' 款高频开发者工具：' + devtools().map(function (d) { return d.name; }).join('、') +
          '。全部在浏览器本地运行，不上传输入内容，无需登录。';
      case 'about':
        return 'AGI Hunt 的收录标准、数据来源说明、开发者工具与键盘快捷键。';
      case 'favorites':
        return '保存在本机浏览器中的 AI 工具收藏列表，不上传、不关联账号。';
      case 'notfound':
        return '请求的页面不存在，可返回 AI 工具库继续浏览。';
      default: {
        var cats = (root.AGI && root.AGI.CATEGORIES) || [];
        return 'AGI Hunt 是中文 AI 工具导航：收录 ' + tools().length + ' 款对话、写作、绘画、视频、编程、Agent、MCP 与 DSH 插件，' +
          '按 ' + cats.length + ' 个场景分类检索；另附 ' + devtools().length + ' 款纯前端开发者工具，数据不出本机。';
      }
    }
  }

  root.AGI_SEO = {
    SITE: SITE,
    BRAND: BRAND,
    CAT_SEO: CAT_SEO,
    DEV_SEO: DEV_SEO,
    HUBS: HUBS,
    hubBySlug: hubBySlug,
    hubList: hubList,
    tagCount: tagCount,
    catCount: catCount,
    canonical: canonical,
    title: title,
    description: description,
    h1: h1,
    priceLabel: priceLabel,
    platformLabel: platformLabel,
    catName: catName,
    width: width
  };
})(typeof window !== 'undefined' ? window : globalThis);
