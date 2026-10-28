// Client half of the dsh-meeting bundle.
//
// One destination: the left sidebar's global panel list (`sidebar.panellist`)
// plus the central panel (`main`, keyed by the same id) — a QQ-style group chat
// view of the meeting room:
//
//   * left  — the event feed: who sent what to whom, who silently read whom
//   * right — the member roster, click to open that conversation
//
// Data comes from the host half's read-only `/dsh-meeting/api` snapshot, which
// is built from the same audit log the model tools write. Polling keeps it
// live without a second transport.
window.__ModuleLoader__.load({
  id: "@tom2012/dsh-meeting",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const STYLE_ID = "dsh-meeting-panel";

    const STATUS_COLOR = {
      running: "#22b07d",
      idle: "#e2a33c",
      cold: "#8b8f96",
    };

    const STATUS_LABEL = {
      running: "运行中",
      idle: "空闲",
      cold: "未打开",
    };

    const REASON_LABEL = {
      steer: "插队送达",
      followup: "排队送达",
      wake: "叫醒送达",
      self: "拒绝：发给自己",
      muted: "拒绝：对方静音",
      "rate-limit": "拒绝：触发限速",
      "hop-limit": "拒绝：超过 4 跳",
      "too-long": "拒绝：正文过长",
      empty: "拒绝：正文为空",
      "unknown-target": "拒绝：找不到成员",
      "no-cwd": "拒绝：对方无工作目录",
      "wake-disabled": "拒绝：对方关闭唤醒",
      "deliver-error": "投递失败",
    };

    const CSS = `
.dsm-wrap{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.dsm-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsm-title{font-size:16px;font-weight:600;letter-spacing:.2px}
.dsm-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsm-legend{margin-left:auto;display:flex;gap:12px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsm-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;vertical-align:1px}
.dsm-body{display:flex;flex:1;min-height:0}
.dsm-feed{flex:1;min-width:0;display:flex;flex-direction:column}
.dsm-feed-scroll{flex:1;overflow-y:auto;padding:12px 14px 20px}
.dsm-feed-scroll::-webkit-scrollbar{width:8px}
.dsm-feed-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px}
.dsm-row{display:flex;gap:10px;padding:9px 10px;border-radius:var(--dsw-radius-md);transition:background .12s}
.dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsm-av{width:30px;height:30px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;color:#fff;letter-spacing:.3px}
.dsm-main{min-width:0;flex:1}
.dsm-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;line-height:1.5}
.dsm-name{font-weight:600;cursor:pointer;border-radius:4px;padding:0 2px}
.dsm-name:hover{background:var(--dsw-alias-interactive-bg-hover);text-decoration:underline}
.dsm-arrow{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsm-time{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.dsm-text{margin-top:3px;color:var(--dsw-alias-label-secondary);line-height:1.55;white-space:pre-wrap;word-break:break-word}
.dsm-text.quiet{color:var(--dsw-alias-label-tertiary);font-style:normal}
.dsm-chip{font-size:10px;padding:1px 6px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsm-chip.ok{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent)}
.dsm-chip.bad{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.dsm-side{width:250px;flex:none;border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0}
.dsm-side-head{padding:12px 14px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:6px}
.dsm-side-list{flex:1;overflow-y:auto;padding:0 8px 16px}
.dsm-member{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.dsm-member:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsm-dot{width:7px;height:7px;border-radius:50%;flex:none}
.dsm-member-body{min-width:0;flex:1}
.dsm-member-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-member-path{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}
.dsm-empty{padding:40px 20px;text-align:center;color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsm-foot{padding:8px 18px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;display:flex;gap:8px;align-items:center}
.dsm-sep{flex:1}
`;

    function ensureStyles() {
      if (typeof document === "undefined") return;
      const selector = 'style[data-plugin-css="' + STYLE_ID + '"]';
      const existing = document.querySelector(selector);
      if (existing) {
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return;
      }
      const tag = document.createElement("style");
      tag.setAttribute("data-plugin-css", STYLE_ID);
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ---------------------------------------------------------------- helpers

    function initials(name) {
      const text = String(name || "?");
      const tail = text.replace(/^agent-/, "");
      return (tail || text).slice(0, 2).toUpperCase();
    }

    function nameColor(name) {
      const text = String(name || "");
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) | 0;
      }
      const palette = ["#4f8cff", "#22b07d", "#9b59d0", "#e2a33c", "#ff7a59", "#2aa8c4", "#e05a6b", "#7c9cf5"];
      return palette[Math.abs(hash) % palette.length];
    }

    function fmtClock(at) {
      if (!at) return "";
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function fmtDay(at) {
      if (!at) return "";
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    }

    function shortPath(path) {
      if (!path) return "";
      const parts = String(path).split("/").filter(Boolean);
      return parts.length <= 2 ? path : "…/" + parts.slice(-2).join("/");
    }

    function Avatar({ name }) {
      return h(
        "div",
        { className: "dsm-av", style: { background: nameColor(name) }, "aria-hidden": "true" },
        initials(name),
      );
    }

    function NameChip({ id, name, onJump }) {
      const [hover, setHover] = useState(false);
      if (!name) return null;
      return h(
        "span",
        {
          className: "dsm-name",
          role: "link",
          tabIndex: 0,
          title: "打开这个会话",
          style: hover ? { textDecoration: "underline" } : undefined,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: (event) => {
            event.stopPropagation();
            onJump(id);
          },
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onJump(id);
            }
          },
        },
        name,
      );
    }

    // ------------------------------------------------------------------- data

    function useChatData() {
      const [state, setState] = useState({ loading: true, error: null, members: [], events: [] });
      useEffect(() => {
        let alive = true;
        let timer = 0;
        const load = async () => {
          try {
            const response = await fetch("/dsh-meeting/api", { headers: { accept: "application/json" } });
            if (!response.ok) throw new Error("HTTP " + response.status);
            const data = await response.json();
            if (!alive) return;
            setState({
              loading: false,
              error: null,
              members: Array.isArray(data.members) ? data.members : [],
              events: Array.isArray(data.events) ? data.events : [],
            });
          } catch (error) {
            if (!alive) return;
            setState((prev) => ({ ...prev, loading: false, error: String((error && error.message) || error) }));
          }
        };
        load();
        timer = setInterval(load, 3000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      return state;
    }

    // -------------------------------------------------------------------- rows

    function SendRow({ event, onJump, showDay }) {
      const failed = event.ok !== true;
      const chip = REASON_LABEL[event.reason] || (failed ? "已拒绝" : "已送达");
      const preview = typeof event.preview === "string" && event.preview !== "" ? event.preview : "（空）";
      return h(
        "div",
        { className: "dsm-row" },
        h(Avatar, { name: event.from && event.from.name }),
        h(
          "div",
          { className: "dsm-main" },
          h(
            "div",
            { className: "dsm-meta" },
            h(NameChip, { id: event.from && event.from.id, name: event.from && event.from.name, onJump }),
            h("span", { className: "dsm-arrow" }, "→"),
            h(NameChip, { id: event.to && event.to.id, name: event.to && event.to.name, onJump }),
            h("span", { className: "dsm-chip " + (failed ? "bad" : "ok") }, chip),
            event.hops > 1 ? h("span", { className: "dsm-chip" }, "第 " + event.hops + " 跳") : null,
            h("span", { className: "dsm-time" }, (showDay ? fmtDay(event.at) + " " : "") + fmtClock(event.at)),
          ),
          h("div", { className: "dsm-text" }, preview),
        ),
      );
    }

    function ReadRow({ event, onJump, showDay }) {
      return h(
        "div",
        { className: "dsm-row" },
        h(Avatar, { name: event.from && event.from.name }),
        h(
          "div",
          { className: "dsm-main" },
          h(
            "div",
            { className: "dsm-meta" },
            h(NameChip, { id: event.from && event.from.id, name: event.from && event.from.name, onJump }),
            h("span", { className: "dsm-chip" }, "静默查看"),
            h("span", { className: "dsm-arrow" }, "→"),
            h(NameChip, { id: event.to && event.to.id, name: event.to && event.to.name, onJump }),
            h("span", { className: "dsm-time" }, (showDay ? fmtDay(event.at) + " " : "") + fmtClock(event.at)),
          ),
          h("div", { className: "dsm-text quiet" }, "读了 " + (event.count || 0) + " 条（从 seq " + event.fromSeq + " 起）"),
        ),
      );
    }

    function MemberRow({ member, onJump }) {
      const color = STATUS_COLOR[member.status] || STATUS_COLOR.cold;
      return h(
        "div",
        {
          className: "dsm-member",
          role: "button",
          tabIndex: 0,
          title: member.cwd || member.name,
          onClick: () => onJump(member.id),
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onJump(member.id);
            }
          },
        },
        h("span", {
          className: "dsm-dot",
          style: { background: color, boxShadow: member.status === "running" ? "0 0 0 3px " + color + "22" : undefined },
        }),
        h(
          "div",
          { className: "dsm-member-body" },
          h("div", { className: "dsm-member-name" }, member.name + (member.muted ? "（静音）" : "")),
          h("div", { className: "dsm-member-path" }, member.cwd ? shortPath(member.cwd) : "无工作目录"),
        ),
      );
    }

    // ------------------------------------------------------------------- panel

    function MeetingPanel({ openSession }) {
      const data = useChatData();
      const scrollRef = useRef(null);
      const pinnedRef = useRef(true);

      const events = data.events;
      const jump = useCallback(
        (sessionId) => {
          if (!sessionId) return;
          try {
            openSession(sessionId);
          } catch (error) {
            console.error("[dsh-meeting] openSession failed:", error);
          }
        },
        [openSession],
      );

      useEffect(() => {
        const node = scrollRef.current;
        if (!node || !pinnedRef.current) return;
        node.scrollTop = node.scrollHeight;
      }, [events.length]);

      const onScroll = () => {
        const node = scrollRef.current;
        if (!node) return;
        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
      };

      const members = data.members;
      const running = members.filter((member) => member.status === "running").length;
      const lastDay = useMemo(() => {
        // 第一条永远带日期：否则事件流开头那条（常常是往日的）只显示时分秒，
        // 滚动到跨天的位置时会看不出来是哪天。
        let previous = null;
        const marks = new Map();
        for (const event of events) {
          const day = fmtDay(event.at);
          marks.set(event.seq, day !== "" && (previous === null || day !== previous));
          if (day !== "") previous = day;
        }
        return marks;
      }, [events]);

      return h(
        "div",
        { className: "dsm-wrap" },
        h(
          "div",
          { className: "dsm-head" },
          h("span", { className: "dsm-title" }, "群聊"),
          h("span", { className: "dsm-sub" }, members.length + " 位成员 · " + running + " 位在跑"),
          h(
            "div",
            { className: "dsm-legend" },
            h("span", null, h("i", { style: { background: STATUS_COLOR.running } }), "运行中"),
            h("span", null, h("i", { style: { background: STATUS_COLOR.idle } }), "空闲"),
            h("span", null, h("i", { style: { background: STATUS_COLOR.cold } }), "未打开"),
          ),
        ),
        h(
          "div",
          { className: "dsm-body" },
          h(
            "div",
            { className: "dsm-feed" },
            h(
              "div",
              { className: "dsm-feed-scroll", ref: scrollRef, onScroll },
              data.error
                ? h("div", { className: "dsm-empty" }, "读不到会议室：" + data.error, h("br"), "宿主端 /dsh-meeting/api 可能还没加载。")
                : events.length === 0
                  ? h(
                      "div",
                      { className: "dsm-empty" },
                      data.loading ? "加载中…" : "还没有动静。",
                      h("br"),
                      "在对话里让模型调用 meeting_send / meeting_read，这里就会出现记录。",
                    )
                  : events.map((event) =>
                      event.kind === "read"
                        ? h(ReadRow, { key: event.seq, event, onJump: jump, showDay: lastDay.get(event.seq) })
                        : h(SendRow, { key: event.seq, event, onJump: jump, showDay: lastDay.get(event.seq) }),
                    ),
            ),
          ),
          h(
            "div",
            { className: "dsm-side" },
            h("div", { className: "dsm-side-head" }, "成员 " + members.length),
            h(
              "div",
              { className: "dsm-side-list" },
              members.map((member) => h(MemberRow, { key: member.id, member, onJump: jump })),
            ),
          ),
        ),
        h(
          "div",
          { className: "dsm-foot" },
          h("span", null, "只读视图：发言请让模型调用 meeting_send"),
          h("span", { className: "dsm-sep" }),
          h("span", null, data.loading ? "同步中…" : "每 3 秒刷新"),
        ),
      );
    }

    function MeetingIcon() {
      return h(
        "svg",
        {
          width: 18,
          height: 18,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" }),
        h("path", { d: "M8 9h8" }),
        h("path", { d: "M8 12.5h5" }),
      );
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ensureStyles();

        const openSession = (sessionId) => {
          const workspace = ctx.get("uiWorkspace");
          if (workspace && typeof workspace.openSession === "function") {
            workspace.openSession(sessionId);
          }
        };

        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register({ name: "sidebar.panellist", id: "meeting", order: 6, label: "群聊" }, MeetingIcon),
        );

        ctx.slots.inject("main", () =>
          ctx.slots.register({ name: "main", key: "meeting" }, () => h(MeetingPanel, { openSession })),
        );
      },
    };
  },
});
