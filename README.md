# kimi-search-mcp

基于 Node.js 的本地 stdio MCP Server，将 Kimi 开放平台的联网搜索 Basic、联网搜索 Pro 和网页抓取 REST API 封装为三个 MCP 工具。

## 工具

| 工具 | Kimi API | 说明 |
|---|---|---|
| `kimi_search` | `POST /v1/tools/search` | 返回标题、URL、摘要、日期和来源权威性，可选网页正文 |
| `kimi_search_pro` | `POST /v1/tools/search_pro` | 返回相关正文片段，支持站点与发布时间过滤，适合问答、RAG 和研究 |
| `kimi_fetch` | `POST /v1/tools/fetch` | 抓取指定 HTTP/HTTPS 网页，返回标题和 Markdown 正文 |

工程特性：

- 纯本地 stdio 模式，无需部署 HTTP 服务
- API Key 只从环境变量 `MOONSHOT_API_KEY` 读取
- 408、429 和部分 5xx 错误自动重试，最多 3 次
- 搜索超时参数为 1–60 秒，客户端额外预留 10 秒网络时间
- 日志只写入 stderr，不干扰 stdio MCP 协议

## 要求

- Node.js 18 或更高版本
- [Kimi API 开放平台](https://platform.moonshot.cn/)的 API Key

## 安装

```bash
git clone https://github.com/Wildare-98/kimi-search-mcp.git
cd kimi-search-mcp
npm install
```

## Kimi Code 配置

在用户级 `~/.kimi-code/mcp.json` 或项目级 `.kimi-code/mcp.json` 中加入：

```json
{
  "mcpServers": {
    "kimi-search": {
      "command": "node",
      "args": ["D:/AIFile/kimicode/Chatbot/kimi-search-mcp/index.js"],
      "env": {
        "MOONSHOT_API_KEY": "sk-你的key"
      }
    }
  }
}
```

将 `args` 中的路径替换为实际绝对路径。也可以把 `MOONSHOT_API_KEY` 设为系统环境变量，然后删除配置中的 `env` 段，避免把密钥写入配置文件。

新增配置只会注册到新会话。保存后新建会话，使用 `/mcp` 检查连接状态。

其他支持相同 JSON 配置的 MCP 客户端也可使用该配置，只需调整绝对路径。

## 使用建议

1. 普通搜索先调用 `kimi_search`，保持 `include_content=false`。
2. 需要直接获取相关段落、限定站点或时间时，调用 `kimi_search_pro`。
3. 已知 URL 或需要阅读完整网页时，调用 `kimi_fetch`。

搜索查询应尽量包含明确的实体、时间和来源限定词。`kimi_search_pro` 的 `time_window` 日期格式支持 `YYYY`、`YYYY-MM` 和 `YYYY-MM-DD`，`sites` 最多包含 5 个站点。

## 可选环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MOONSHOT_API_KEY` | 无，必填 | Kimi API Key |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.cn/v1` | API 基础地址，用于兼容代理或测试 |

## 计费

三个接口按成功且非空的结果分别计费；失败、超时或空结果不计费。详见[联网搜索定价](https://platform.moonshot.cn/docs/pricing/tools)。

## API 文档

- [联网搜索 Basic](https://platform.kimi.com/docs/api/tools-search)
- [联网搜索 Pro](https://platform.kimi.com/docs/api/tools-search-pro)
- [网页抓取](https://platform.kimi.com/docs/api/tools-fetch)
