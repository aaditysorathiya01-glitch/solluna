# Third-party notices

## no-ai-slop — writing-style patterns
The manager agent's writing-style rules (`apps/api/src/chat/manager-prompt.ts`) and the soft `ai_slop` check (`apps/api/src/chat/guardrails.ts`) are adapted from https://github.com/petergyang/no-ai-slop.

MIT License — Copyright (c) 2026 Peter Yang

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Ideas used without code
- claude-mem (Apache-2.0, https://github.com/thedotmack/claude-mem): compact memory index + details on demand → the manager's rolling `chat_summary`. No code copied.
- context-mode (Elastic License 2.0, https://github.com/mksglu/context-mode): keep large tool output out of the model's context → short tool results. No code copied (ELv2 limits offering it as a hosted service).
