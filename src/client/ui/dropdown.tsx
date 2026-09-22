import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type SyntheticEvent, useEffect, useId, useRef, useState } from "react";

interface DropdownOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

interface DropdownSelectProps {
  id?: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  initialFocus?: boolean;
}

interface DropdownComboboxProps {
  id: string;
  value: string;
  suggestions: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

interface DropdownOptionGroup {
  label?: string;
  options: DropdownOption[];
}

interface DropdownOptionsProps {
  menuId: string;
  options: readonly DropdownOption[];
  value: string;
  onSelect: (value: string) => void;
  caseInsensitive?: boolean;
}

function groupOptions(options: readonly DropdownOption[]): DropdownOptionGroup[] {
  const groups: DropdownOptionGroup[] = [];
  for (const option of options) {
    const previous = groups.at(-1);
    if (previous && previous.label === option.group) previous.options.push(option);
    else groups.push({ label: option.group, options: [option] });
  }
  return groups;
}

function optionButtons(menu: HTMLDivElement | null): HTMLButtonElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
}

function focusAdjacentControl(control: HTMLElement | null, direction: 1 | -1) {
  if (!control) return;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((candidate) => {
    const bounds = candidate.getBoundingClientRect();
    return !candidate.closest("[inert]") && bounds.width > 0 && bounds.height > 0;
  });
  const current = candidates.indexOf(control);
  const next = candidates[current + direction];
  next?.focus({ preventScroll: true });
}

function handleOptionListKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  {
    menu,
    owner,
    onClose,
    onTypeahead,
  }: {
    menu: HTMLDivElement | null;
    owner: HTMLElement | null;
    onClose: (restoreFocus: boolean) => void;
    onTypeahead?: (key: string) => void;
  },
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose(true);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    onClose(false);
    focusAdjacentControl(owner, event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    const activeOption = document.activeElement;
    if (activeOption instanceof HTMLButtonElement && activeOption.matches('[role="option"]')) {
      event.preventDefault();
      activeOption.click();
    }
    return;
  }

  const items = optionButtons(menu);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (Math.max(current, -1) + 1) % items.length
            : (current <= 0 ? items.length : current) - 1;
    items[next]?.focus({ preventScroll: true });
    items[next]?.scrollIntoView({ block: "nearest" });
    return;
  }

  if (onTypeahead && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    onTypeahead(event.key);
  }
}

function DropdownOptions({
  menuId,
  options,
  value,
  onSelect,
  caseInsensitive = false,
}: DropdownOptionsProps) {
  const groups = groupOptions(options);
  const normalizedValue = caseInsensitive ? value.trim().toLocaleLowerCase() : value;
  return groups.map((group) => {
    const groupKey = group.label ?? `options-${group.options[0]?.value ?? "empty"}`;
    const groupId = `${menuId}-group-${groupKey.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const content = group.options.map((option) => {
      const optionValue = caseInsensitive ? option.value.toLocaleLowerCase() : option.value;
      const selected = optionValue === normalizedValue;
      return (
        <button
          key={option.value}
          className="dropdown-select-option"
          type="button"
          role="option"
          aria-selected={selected}
          disabled={option.disabled}
          data-value={option.value}
          onClick={() => onSelect(option.value)}
        >
          <span>{option.label}</span>
          {selected ? <Check aria-hidden="true" size={15} strokeWidth={2.2} /> : null}
        </button>
      );
    });
    return group.label ? (
      <fieldset key={groupKey} className="dropdown-select-group" aria-labelledby={groupId}>
        <legend id={groupId} className="dropdown-select-group-label">
          {group.label}
        </legend>
        {content}
      </fieldset>
    ) : (
      <div key={groupKey}>{content}</div>
    );
  });
}

export function DropdownSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  className,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocus = false,
}: DropdownSelectProps) {
  const generatedId = useId().replace(/:/g, "");
  const triggerId = id ?? `dropdown-${generatedId}`;
  const menuId = `${triggerId}-listbox`;
  const anchorName = `--${triggerId}-anchor`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"selected" | "first" | "last">("selected");
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  const focusOption = (target: "selected" | "first" | "last") => {
    const items = optionButtons(menuRef.current);
    if (items.length === 0) return;
    const selected = items.find((item) => item.dataset.value === value);
    const next =
      target === "first" ? items[0] : target === "last" ? items.at(-1) : (selected ?? items[0]);
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: "nearest" });
  };

  const showMenu = (target: "selected" | "first" | "last" = "selected") => {
    if (disabled) return;
    pendingFocus.current = target;
    const menu = menuRef.current;
    if (menu && !menu.matches(":popover-open")) menu.showPopover();
  };

  const hideMenu = (restoreFocus: boolean) => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const focusByPrefix = (prefix: string, startAfterCurrent: boolean) => {
    const items = optionButtons(menuRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const ordered =
      startAfterCurrent && current >= 0
        ? [...items.slice(current + 1), ...items.slice(0, current + 1)]
        : items;
    ordered
      .find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix))
      ?.focus({ preventScroll: true });
  };

  const handleTypeahead = (key: string) => {
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current);
    typeahead.current += key.toLocaleLowerCase();
    focusByPrefix(typeahead.current, typeahead.current.length === 1);
    typeaheadTimer.current = window.setTimeout(() => {
      typeahead.current = "";
      typeaheadTimer.current = null;
    }, 600);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      showMenu(event.key === "ArrowDown" ? "first" : "last");
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      pendingFocus.current = "selected";
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      showMenu("selected");
      window.requestAnimationFrame(() => handleTypeahead(event.key));
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handleOptionListKeyDown(event, {
      menu: menuRef.current,
      owner: triggerRef.current,
      onClose: hideMenu,
      onTypeahead: handleTypeahead,
    });
  };

  const handleToggle = (event: SyntheticEvent<HTMLDivElement>) => {
    const nextOpen = event.currentTarget.matches(":popover-open");
    setOpen(nextOpen);
    if (nextOpen) window.requestAnimationFrame(() => focusOption(pendingFocus.current));
  };

  useEffect(() => {
    const menu = menuRef.current;
    if (disabled && menu?.matches(":popover-open")) menu.hidePopover();
  }, [disabled]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className="dropdown-select-menu dropdown-menu-surface"
      popover="auto"
      role="listbox"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-required={required || undefined}
      style={{ positionAnchor: anchorName }}
      onToggle={handleToggle}
      onKeyDown={handleMenuKeyDown}
    >
      <DropdownOptions
        menuId={menuId}
        options={options}
        value={value}
        onSelect={(nextValue) => {
          onChange(nextValue);
          hideMenu(true);
        }}
      />
    </div>
  );

  return (
    <div className={`dropdown-select${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        className="dropdown-select-trigger"
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        popoverTarget={menuId}
        style={{ anchorName }}
        data-dialog-initial-focus={initialFocus || undefined}
        onPointerDown={() => {
          pendingFocus.current = "selected";
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label ?? value}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {menu}
    </div>
  );
}

export function DropdownCombobox({
  id,
  value,
  suggestions,
  onChange,
  disabled = false,
  required = false,
  maxLength,
  ariaLabel,
  ariaDescribedBy,
}: DropdownComboboxProps) {
  const menuId = `${id}-listbox`;
  const anchorName = `--${id}-anchor`;
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const showMenu = (target?: "first" | "last") => {
    if (disabled) return;
    const menu = menuRef.current;
    if (menu && !menu.matches(":popover-open")) menu.showPopover();
    if (target) {
      window.requestAnimationFrame(() => {
        const items = optionButtons(menuRef.current);
        const next = target === "first" ? items[0] : items.at(-1);
        next?.focus({ preventScroll: true });
        next?.scrollIntoView({ block: "nearest" });
      });
    }
  };

  const hideMenu = (restoreFocus: boolean) => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus) inputRef.current?.focus({ preventScroll: true });
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handleOptionListKeyDown(event, {
      menu: menuRef.current,
      owner: inputRef.current,
      onClose: hideMenu,
    });
  };

  useEffect(() => {
    const menu = menuRef.current;
    if (disabled && menu?.matches(":popover-open")) menu.hidePopover();
  }, [disabled]);

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className="dropdown-select-menu dropdown-menu-surface"
      popover="auto"
      role="listbox"
      aria-label={ariaLabel ? `${ariaLabel} suggestions` : "Suggestions"}
      style={{ positionAnchor: anchorName }}
      onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      onKeyDown={handleMenuKeyDown}
    >
      <DropdownOptions
        menuId={menuId}
        options={suggestions.map((suggestion) => ({ value: suggestion, label: suggestion }))}
        value={value}
        caseInsensitive
        onSelect={(suggestion) => {
          onChange(suggestion);
          hideMenu(true);
        }}
      />
    </div>
  );

  return (
    <div className="dropdown-combobox" data-open={open || undefined}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        value={value}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        style={{ anchorName }}
        onPointerDown={() => {
          if (!open) showMenu();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          showMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            showMenu(event.key === "ArrowDown" ? "first" : "last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            hideMenu(false);
          }
        }}
      />
      <ChevronDown aria-hidden="true" size={16} />
      {menu}
    </div>
  );
}
