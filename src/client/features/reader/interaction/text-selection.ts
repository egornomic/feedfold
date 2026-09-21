interface SelectionBoundary {
  path: number[];
  offset: number;
}

export interface TextSelectionSnapshot {
  start: SelectionBoundary;
  end: SelectionBoundary;
  text: string;
}

function nodePath(root: Node, target: Node): number[] | null {
  const path: number[] = [];
  let node: Node | null = target;

  while (node !== root) {
    const parent: Node | null = node.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
    if (index < 0) return null;
    path.unshift(index);
    node = parent;
  }

  return path;
}

function nodeFromPath(root: Node, path: number[]): Node | null {
  let node = root;
  for (const index of path) {
    const child = node.childNodes.item(index);
    if (!child) return null;
    node = child;
  }
  return node;
}

export function captureTextSelection(
  root: HTMLElement,
  selection: Selection | null = root.ownerDocument.getSelection(),
): TextSelectionSnapshot | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const startPath = nodePath(root, range.startContainer);
  const endPath = nodePath(root, range.endContainer);
  if (!startPath || !endPath) return null;

  return {
    start: { path: startPath, offset: range.startOffset },
    end: { path: endPath, offset: range.endOffset },
    text: range.toString(),
  };
}

export function restoreTextSelection(root: HTMLElement, snapshot: TextSelectionSnapshot): boolean {
  const startNode = nodeFromPath(root, snapshot.start.path);
  const endNode = nodeFromPath(root, snapshot.end.path);
  const selection = root.ownerDocument.getSelection();
  if (!startNode || !endNode || !selection) return false;

  const range = root.ownerDocument.createRange();
  try {
    range.setStart(startNode, snapshot.start.offset);
    range.setEnd(endNode, snapshot.end.offset);
  } catch {
    return false;
  }

  if (range.toString() !== snapshot.text) return false;

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
