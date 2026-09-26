import { Popover } from "@base-ui/react/popover";
import { ListFilter } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AiCustomPrompt, Article } from "../../../../shared/types";
import { surfaceTransition } from "../../../ui/motion";
import type { FeedManagementAction } from "../../feeds/feed-management";
import {
  captureTextSelection,
  restoreTextSelection,
  type TextSelectionSnapshot,
} from "../interaction/text-selection";
import { ArticleSummaryPanel, ArticleTranslationNotice } from "./article-ai-panels";
import type { ArticleSummaryViewState, ArticleTranslationViewState } from "./article-ai-state";
import { ArticleBody } from "./article-body";
import { ArticleHeader } from "./article-header";

interface SelectionMenuState {
  text: string;
  selection: TextSelectionSnapshot;
  left: number;
  top: number;
  placement: "above" | "below";
}

export function ArticleDocument({
  article,
  titleId,
  contentPlaceholder,
  fullContentVisible,
  summaryState,
  translationState,
  translationLanguage,
  customPrompts,
  showYouTubeDescriptions,
  onFeedAction,
  onToggleFullContent,
  onRegenerateSummary,
  onOpenAiSettings,
  onFilterSelection,
}: {
  article: Article;
  titleId: string;
  contentPlaceholder?: React.ReactNode;
  fullContentVisible: boolean;
  summaryState: ArticleSummaryViewState;
  translationState: ArticleTranslationViewState;
  translationLanguage: string;
  customPrompts: AiCustomPrompt[];
  showYouTubeDescriptions: boolean;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
  onToggleFullContent: (article: Article) => void;
  onRegenerateSummary: (article: Article) => void;
  onOpenAiSettings: () => void;
  onFilterSelection: (article: Article, text: string) => void;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  const reduced = Boolean(useReducedMotion());
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);
  const retainedSelectionMenu = useRef<SelectionMenuState | null>(selectionMenu);
  if (selectionMenu) retainedSelectionMenu.current = selectionMenu;
  const displayedSelectionMenu = selectionMenu ?? retainedSelectionMenu.current;

  const showSelectionMenu = useCallback(() => {
    const root = documentRef.current;
    const selection = window.getSelection();
    if (
      !root ||
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    ) {
      setSelectionMenu(null);
      return;
    }

    const selectionSnapshot = captureTextSelection(root, selection);
    const text = selectionSnapshot?.text.replace(/\s+/g, " ").trim() ?? "";
    const bounds = selection.getRangeAt(0).getBoundingClientRect();
    if (!selectionSnapshot || !text || (bounds.width === 0 && bounds.height === 0)) {
      setSelectionMenu(null);
      return;
    }

    const placement = bounds.top < 56 ? "below" : "above";
    setSelectionMenu({
      text,
      selection: selectionSnapshot,
      left: Math.min(window.innerWidth - 52, Math.max(52, bounds.left + bounds.width / 2)),
      top: placement === "above" ? bounds.top : bounds.bottom,
      placement,
    });
  }, []);

  useEffect(() => {
    const root = documentRef.current;
    if (!root) return;

    const dismiss = () => setSelectionMenu(null);
    root.addEventListener("pointerdown", dismiss);
    root.addEventListener("pointerup", showSelectionMenu);
    root.addEventListener("keyup", showSelectionMenu);
    return () => {
      root.removeEventListener("pointerdown", dismiss);
      root.removeEventListener("pointerup", showSelectionMenu);
      root.removeEventListener("keyup", showSelectionMenu);
    };
  }, [showSelectionMenu]);

  useLayoutEffect(() => {
    const root = documentRef.current;
    if (!root || !selectionMenu) return;
    restoreTextSelection(root, selectionMenu.selection);
  }, [selectionMenu]);

  useEffect(() => {
    if (!selectionMenu) return;
    const dismiss = () => setSelectionMenu(null);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [selectionMenu]);

  return (
    <>
      <div ref={documentRef} className="article-document">
        <ArticleHeader article={article} id={titleId} onFeedAction={onFeedAction} />
        <div className="article-document-flow">
          {contentPlaceholder ?? (
            <LayoutGroup>
              <AnimatePresence initial={false} custom={{ reduced }}>
                {summaryState.visible ? (
                  <ArticleSummaryPanel
                    article={article}
                    state={summaryState}
                    customPrompts={customPrompts}
                    onRegenerate={onRegenerateSummary}
                    onOpenSettings={onOpenAiSettings}
                  />
                ) : null}
              </AnimatePresence>
              <motion.div
                layout="position"
                transition={{ layout: reduced ? { duration: 0 } : surfaceTransition(false) }}
                className="article-reading-flow"
              >
                <ArticleTranslationNotice
                  state={translationState}
                  language={translationLanguage}
                  onOpenSettings={onOpenAiSettings}
                />
                <ArticleBody
                  article={article}
                  fullContentVisible={fullContentVisible}
                  translationState={translationState}
                  showYouTubeDescriptions={showYouTubeDescriptions}
                  onToggleFullContent={onToggleFullContent}
                />
              </motion.div>
            </LayoutGroup>
          )}
        </div>
      </div>
      {displayedSelectionMenu ? (
        <Popover.Root
          open={selectionMenu !== null}
          onOpenChange={(open, details) => {
            if (!open) {
              if (details.reason === "escape-key") window.getSelection()?.removeAllRanges();
              setSelectionMenu(null);
            }
          }}
        >
          <Popover.Portal>
            <Popover.Positioner
              className="overlay-positioner"
              anchor={{
                getBoundingClientRect: () =>
                  new DOMRect(displayedSelectionMenu.left, displayedSelectionMenu.top, 0, 0),
              }}
              side={displayedSelectionMenu.placement === "above" ? "top" : "bottom"}
              align="center"
              sideOffset={8}
              collisionPadding={8}
            >
              <Popover.Popup
                ref={menuRef}
                className="overlay-menu article-selection-menu"
                role="toolbar"
                aria-label="Selected text actions"
                initialFocus={false}
                finalFocus={false}
              >
                <button
                  type="button"
                  aria-label="Filter selected text"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const { text } = displayedSelectionMenu;
                    setSelectionMenu(null);
                    onFilterSelection(article, text);
                  }}
                >
                  <ListFilter aria-hidden="true" size={15} />
                  Filter
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </>
  );
}
