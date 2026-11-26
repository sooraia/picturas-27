"use client";

import { LoaderCircle } from "lucide-react";
import { Transition } from "@headlessui/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

// Non-blocking processing indicator (DA-1). It replaces the full-screen
// overlay: it sits in a corner, so the rest of the application stays usable
// while the progress and the cancel button remain visible.
export function ProcessingIndicator({
  show,
  progress,
  showPercent,
  cancelling,
  onCancel,
}: {
  show: boolean;
  progress: number;
  showPercent: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <Transition
      show={show}
      enter="transition-opacity ease-in duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 pointer-events-none"
      >
        <Card className="pointer-events-auto p-4 flex flex-col gap-3 shadow-lg sm:w-80">
          <div className="flex gap-2 items-center font-semibold">
            <LoaderCircle className="size-[1em] animate-spin" />
            <span>Processing</span>
            {showPercent && (
              <span className="ml-auto text-xs text-muted-foreground">{progress}%</span>
            )}
          </div>
          <Progress value={progress} className="w-full" />
          <Button variant="outline" size="sm" disabled={cancelling} onClick={onCancel}>
            {cancelling ? <LoaderCircle className="size-[1em] animate-spin" /> : "Cancelar"}
          </Button>
        </Card>
      </div>
    </Transition>
  );
}
