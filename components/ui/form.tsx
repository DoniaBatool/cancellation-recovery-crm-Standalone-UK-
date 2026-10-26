"use client";

import * as React from "react";

/**
 * A <form> that keeps what the person typed after a server action returns.
 *
 * React 19 resets uncontrolled fields after every form action, so one validation error would
 * wipe the whole form. React does this by calling form.reset(), which fires a cancelable
 * `reset` event, so cancelling it keeps the values. Forms that should be cleared after a
 * success remount with a new `key` instead.
 */
export function Form({ onReset, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      {...props}
      onReset={(event) => {
        event.preventDefault();
        onReset?.(event);
      }}
    />
  );
}
