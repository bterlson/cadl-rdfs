/** @typedef { import("@cadl-lang/compiler").DecoratorContext} DecoratorContext */
/** @typedef { import("@cadl-lang/compiler").ModelType} ModelType */
import { $extension } from "@cadl-lang/openapi";


/**
 * 
 * @param {DecoratorContext} context 
 * @param {ModelType} target 
 * @param {bool} isPii 
 */
export function $isPii(context,target,isPii)
{
    context.call($extension, target, "x-ms-pii", isPii);
}


