import { Model, DecoratorContext } from "@cadl-lang/compiler";
import { $extension, getExtension } from "@cadl-lang/openapi";


/**
 * 
 * @param {DecoratorContext} context 
 * @param {Model} target 
 * @param {bool} isPii 
 */
export function $isPii(context,target,isPii)
{
    context.call($extension, target, "x-ms-pii", isPii ?? true);
}


export function getPii(target: Type) {
    const extensions = getExtension(target);
    return extensions.get("x-ms-pii") ?? false;
}
