import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { ago, deleteConversation, listConversations, resumeConversation, type ConversationSummary } from '../platform/conversations.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';

// "Earlier conversations": this folder's saved chats, newest first, narrowed by typing
// (OpenCode's session list and Claude Code's resume picker). Enter or a click carries
// on with one, exactly where it stopped.
const DELETE_BUTTON = ' Delete ';

export function ChatsView({ rows }: { rows: number }) {
  const [all, setAll] = useState<ConversationSummary[]>(() => listConversations());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [askedDelete, setAskedDelete] = useState<string | null>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((chat) => words.every((word) => chat.title.toLowerCase().includes(word)));
  const height = Math.max(1, rows - 4);
  const at = Math.min(selected, Math.max(0, list.length - 1));
  const first = Math.max(0, Math.min(at - Math.floor(height / 2), list.length - height));

  const open = (chat: ConversationSummary | undefined) => {
    if (!chat) return;
    if (session.status === 'working' || session.approvalPending) {
      session.addNotice('An earlier conversation can be opened between tasks - try again when I have finished.');
      session.closeChats();
      return;
    }
    const ok = resumeConversation(chat.id);
    session.closeChats();
    if (!ok) session.addNotice("That conversation couldn't be opened - it may have been damaged.");
    else session.addNotice('Carrying on from where we stopped - go ahead.');
  };

  // Delete asks twice - a click, then another - so one slip never loses a conversation.
  const removeSelected = () => {
    const chat = list[at];
    if (!chat) return;
    if (askedDelete === chat.id) {
      deleteConversation(chat.id);
      setAll(listConversations());
      setAskedDelete(null);
    } else {
      setAskedDelete(chat.id);
    }
  };

  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event) return;
    if (event.kind === 'wheel') return setSelected((c) => Math.max(0, Math.min(list.length - 1, c + (event.button === 0 ? -1 : 1))));
    if (event.kind !== 'press' || event.button !== 0) return;
    // The Delete button on the bottom row (its columns are DELETE_BUTTON wide, from column 2).
    if (event.row === rows) {
      if (event.col >= 2 && event.col <= DELETE_BUTTON.length + 1) removeSelected();
      return;
    }
    // The list starts on the screen's third row (title, search line).
    open(list[first + event.row - 3]);
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) return session.closeChats();
    if (key.upArrow) return setSelected(Math.max(0, at - 1));
    if (key.downArrow) return setSelected(Math.min(list.length - 1, at + 1));
    if (key.return) return open(list[at]);
    if (key.ctrl && input === 'd') return removeSelected();
    setAskedDelete(null);
    if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1)), setSelected(0);
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelected(0);
    }
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor bold>EARLIER CONVERSATIONS</Text>
      <Text>{` Search: ${query}`}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {list.length === 0 ? <Text dimColor>{all.length === 0 ? ' Nothing saved yet in this folder - your conversations are kept here as you go.' : ' Nothing matches.'}</Text> : null}
        {list.slice(first, first + height).map((chat, offset) => (
          <Text key={chat.id} inverse={first + offset === at} wrap="truncate-end">
            {' ' + chat.title}
            <Text dimColor={first + offset !== at}>{'  ' + (askedDelete === chat.id ? 'click Delete again to remove it' : ago(chat.updated))}</Text>
          </Text>
        ))}
      </Box>
      <Text wrap="truncate-end">
        <Text inverse>{DELETE_BUTTON}</Text>
        <Text dimColor>  Type to search · ↑↓ move · Enter or click a chat to carry on · Esc back</Text>
      </Text>
    </Box>
  );
}
