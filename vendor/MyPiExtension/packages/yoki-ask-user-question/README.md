# yoki-ask-user-question

<div align="center">
  <a href="https://github.com/yokii89/MyPiExtension/tree/main/packages/yoki-ask-user-question">
    <picture>
      <img src="https://raw.githubusercontent.com/yokii89/MyPiExtension/main/packages/yoki-ask-user-question/docs/cover.png" alt="yoki-ask-user-question cover" width="50%">
    </picture>
  </a>
</div>

Let the model ask you structured clarifying questions instead of guessing. `yoki-ask-user-question` adds the `ask_user_question` tool to [Pi Agent](https://github.com/badlogic/pi-mono) - a tabbed dialog with single- and multi-select questions and a Submit tab that reviews answers before they go back to the model.

## Features

- **Multi-question dialogs** - ask several questions in one turn with a tab bar (`Tab` to switch).
- **Unified free-text field** - a "Type something." row on every question (single- and multi-select). Text typed with no option selected IS the answer; text typed alongside a selection is returned as that selection's supplement (`user notes:`). Saved drafts survive tab switches and render on the row.
- **Multi-select questions** - checkboxes with `Space` to toggle, Enter-as-toggle on rows, a `Next` sentinel to advance, and toggles persisted across tab switches.
- **Submit tab** - review every answer before submitting; warns about unanswered questions and offers a Submit picker.
- **Terminal-row-aware overflow scroll** - when the dialog is taller than the terminal, the body scrolls between a sticky heading and sticky hints/border; overflow indicators (↑ / ↓ / ↕) show what's clipped.
- **Desktop host (PiDesk)** - when the process runs under PiDesk (or any host that injects `PIDESK_VIEW_*` / `PI_VIEW_*`), the questionnaire is presented as a **floating widget above the task composer** (same family as the @-mention menu) via `@pidesk/view-sdk` instead of the terminal TUI. Falls back automatically when the desktop socket is unavailable.

## Screens

| | |
|---|---|
| ![Single-question dialog](https://raw.githubusercontent.com/yokii89/MyPiExtension/main/packages/yoki-ask-user-question/docs/single-question.jpg) | ![Multi-select with checkboxes](https://raw.githubusercontent.com/yokii89/MyPiExtension/main/packages/yoki-ask-user-question/docs/multi-select.jpg) |
| ![Submit tab review](https://raw.githubusercontent.com/yokii89/MyPiExtension/main/packages/yoki-ask-user-question/docs/submit-tab.jpg) | |

## Install

```bash
pi install git:github.com/yokii89/MyPiExtension
```

Then restart your Pi session.

## Tool

- **`ask_user_question`** - present one or more structured questions, each with 2+ options, optional `multiSelect`, and a built-in free-text field on every question. Text typed with no selection is the answer; text typed alongside a selection comes back as that selection's supplement. See the tool's `promptGuidelines` for usage policy.

### Schema

```ts
ask_user_question({
  questions: [
    {
      question: string,            // full question text, ends with "?"
      header: string,              // chip label, max 16 chars
      options: [
        {
          label: string,           // 1-5 words, max 60 chars
          description: string,     // explains the choice / its trade-off
        },
        // … 2-4 options total
      ],
      multiSelect?: boolean,       // default false
    },
    // … 1-4 questions total
  ]
})
```

Reserved option labels (rejected at validation): `"Other"`, plus the runtime sentinels (`"Type something."`, `"Next"`).

Returns:

```ts
{
  content: [{ type: "text", text: string }], // human-readable envelope or DECLINE_MESSAGE
  details: {
    answers: Array<{
      questionIndex: number,
      question: string,
      kind: "option" | "custom" | "multi",
      answer: string | null,
      selected?: string[],         // present for multi-select
      notes?: string,              // supplement typed alongside a selection
    }>,
    cancelled: boolean,
    error?: "no_ui" | "no_questions" | "empty_options" | "too_many_questions"
          | "duplicate_question" | "duplicate_option_label" | "reserved_label",
  }
}
```

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MIT
