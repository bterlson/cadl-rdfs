/** @typedef { import("@cadl-lang/compiler").DecoratorContext} DecoratorContext */
/** @typedef { import("@cadl-lang/compiler").ModelType} ModelType */
import { $extension } from "@cadl-lang/openapi";

export function $isPii(context,target,isPii)
{
    context.call($extension, target, "x-ms-pii", isPii);
}
