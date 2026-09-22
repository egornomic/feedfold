import { Check, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Folder, FolderSortDirection } from "../../../shared/types";
import { errorMessage } from "../../api/api";
import { DropdownSelect } from "../../ui/dropdown";
import type { MotionState } from "../../ui/motion";
import type { ReaderDataMutations } from "../reader/data-resource";
import { folderPathLabel } from "./folder-hierarchy";

export function FolderForm({
  folders,
  initial,
  defaultParentId = null,
  motionState,
  mutations,
  onCancel,
  onSaved,
  showToast,
}: {
  folders: Folder[];
  initial?: Folder;
  defaultParentId?: number | null;
  motionState?: MotionState;
  mutations: ReaderDataMutations;
  onCancel: () => void;
  onSaved: (folder: Folder) => Promise<void> | void;
  showToast: (message: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState<number | null>(initial?.parentId ?? defaultParentId);
  const [sortDirection, setSortDirection] = useState<FolderSortDirection>(
    initial?.sortDirection ?? "newest",
  );
  const [saving, setSaving] = useState(false);
  const unavailableParentIds = new Set(initial ? [initial.id] : []);
  if (initial) {
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const folder of folders) {
        if (
          folder.parentId !== null &&
          unavailableParentIds.has(folder.parentId) &&
          !unavailableParentIds.has(folder.id)
        ) {
          unavailableParentIds.add(folder.id);
          foundDescendant = true;
        }
      }
    }
  }
  const availableParents = folders.filter((folder) => !unavailableParentIds.has(folder.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const folder = initial
        ? await mutations.updateFolder(initial.id, { name: name.trim(), parentId, sortDirection })
        : await mutations.createFolder({ name: name.trim(), parentId, sortDirection });
      await onSaved(folder);
    } catch (error) {
      showToast(`Could not save the folder: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={`compact-form${motionState ? " add-folder-form" : ""}`}
      data-motion-state={motionState}
      inert={motionState === "closed" ? true : undefined}
      aria-busy={saving}
      onSubmit={(event) => void submit(event)}
    >
      <label className="field">
        <span>Folder name</span>
        <input
          data-dialog-initial-focus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="field">
        <span>Parent folder</span>
        <DropdownSelect
          ariaLabel="Parent folder"
          value={parentId === null ? "" : String(parentId)}
          options={[
            { value: "", label: "No parent" },
            ...availableParents.map((folder) => ({
              value: String(folder.id),
              label: folderPathLabel(folder.id, folders),
            })),
          ]}
          onChange={(value) => setParentId(value ? Number(value) : null)}
        />
      </div>
      <div className="field">
        <span>Article order</span>
        <DropdownSelect
          ariaLabel="Article order"
          value={sortDirection}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ]}
          onChange={(value) => setSortDirection(value as FolderSortDirection)}
        />
      </div>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit" disabled={saving || !name.trim()}>
          {saving ? (
            <LoaderCircle className="spin" aria-hidden="true" size={15} />
          ) : (
            <Check aria-hidden="true" size={15} />
          )}
          {initial ? "Save folder" : "Create folder"}
        </button>
      </div>
    </form>
  );
}
