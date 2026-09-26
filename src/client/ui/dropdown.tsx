import { Autocomplete } from "@base-ui/react/autocomplete";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

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

function groupOptions(options: readonly DropdownOption[]) {
  const groups: { label?: string; options: DropdownOption[] }[] = [];
  for (const option of options) {
    const previous = groups.at(-1);
    if (previous && previous.label === option.group) previous.options.push(option);
    else
      groups.push({
        ...(option.group === undefined ? {} : { label: option.group }),
        options: [option],
      });
  }
  return groups;
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
  return (
    <div className={`dropdown-select${className ? ` ${className}` : ""}`}>
      <Select.Root
        value={value}
        items={options}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
        required={required}
        modal={false}
      >
        <Select.Trigger
          id={id}
          className="dropdown-select-trigger"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          data-dialog-initial-focus={initialFocus || undefined}
        >
          <Select.Value>
            {options.find((option) => option.value === value)?.label ?? value}
          </Select.Value>
          <Select.Icon>
            <ChevronDown aria-hidden="true" size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            className="overlay-positioner"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            alignItemWithTrigger={false}
          >
            <Select.Popup className="overlay-menu dropdown-select-menu dropdown-menu-surface">
              <Select.List>
                {groupOptions(options).map((group) => (
                  <Select.Group
                    key={group.label ?? group.options[0]?.value}
                    className="dropdown-select-group"
                  >
                    {group.label ? (
                      <Select.GroupLabel className="dropdown-select-group-label">
                        {group.label}
                      </Select.GroupLabel>
                    ) : null}
                    {group.options.map((option) => (
                      <Select.Item
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                        className="dropdown-select-option"
                      >
                        <Select.ItemText render={<span />}>{option.label}</Select.ItemText>
                        <Select.ItemIndicator>
                          <Check aria-hidden="true" size={15} strokeWidth={2.2} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Group>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
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
  return (
    <Autocomplete.Root
      items={suggestions}
      value={value}
      onValueChange={onChange}
      mode="none"
      openOnInputClick
    >
      <div className="dropdown-combobox">
        <Autocomplete.Input
          id={id}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
        />
        <ChevronDown aria-hidden="true" size={16} />
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="overlay-positioner"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <Autocomplete.Popup className="overlay-menu dropdown-select-menu dropdown-menu-surface">
            <Autocomplete.List aria-label={ariaLabel ? `${ariaLabel} suggestions` : "Suggestions"}>
              {(suggestion: string) => (
                <Autocomplete.Item
                  key={suggestion}
                  value={suggestion}
                  className="dropdown-select-option"
                  data-selected={
                    suggestion.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
                      ? ""
                      : undefined
                  }
                >
                  <span>{suggestion}</span>
                  {suggestion.toLocaleLowerCase() === value.trim().toLocaleLowerCase() ? (
                    <Check aria-hidden="true" size={15} />
                  ) : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
