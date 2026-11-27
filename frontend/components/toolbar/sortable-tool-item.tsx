"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, GripVertical } from "lucide-react";

export function SortableToolItem({
  tool,
  onRemove,
  disabled = false,
}: {
  tool: any;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tool._id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="flex w-full items-center justify-between rounded bg-muted/50 px-2 py-1"
    >
      <div className="flex items-center gap-2 min-w-0">
        <GripVertical
          className={`w-3 h-3 ${disabled ? "cursor-not-allowed opacity-40" : "cursor-grab"}`}
          {...attributes}
          {...listeners}
        />
        <span className="max-w-[4.5rem] truncate text-[11px]">
            {tool.procedure}
        </span>     
      </div>

      {!disabled && (
        <X
          onClick={() => onRemove(tool._id)}
          className="w-3 h-3 cursor-pointer text-red-500 flex-shrink-0"
        />
      )}
    </div>
  );
}
