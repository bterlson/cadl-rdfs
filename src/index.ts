import { Writer, DataFactory } from "n3";
import path from "path";
const nn = DataFactory.namedNode;

import {
  createDecoratorDefinition,
  DecoratorContext,
  ModelType,
  NamespaceType,
  Program,
  navigateProgram,
  Type,
  ModelTypeProperty,
  getIntrinsicModelName,
  getDoc,
  isArrayModelType,
} from "@cadl-lang/compiler";
import { getIntrinsicType } from "@azure-tools/adl";

/*
notes for updating to next release:
* Replace symbol.for with createStateSymbol
* Drop 'Type' suffix
*/

export function $onEmit(program: Program) {
  const emitter = createRdfEmitter(program);
  emitter.emit();
}

function createRdfEmitter(program: Program) {
  const prefixes: Record<string, string> = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };

  const writer = new Writer({ prefixes });

  return {
    emit,
  };

  function emit() {
    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }
        const nameNode = nn(nameForModel(m));
        writer.addQuad(nameNode, nn("rdf:type"), nn("rdfs:Class"));

        if (m.baseModel) {
          writer.addQuad(
            nameNode,
            nn("rdfs:isSubclassOf"),
            nn(nameForModel(m.baseModel))
          );
        }

        const doc = getDoc(program, m);
        if (doc) {
          writer.addQuad(
            nameNode,
            nn("rdfs:comment"),
            DataFactory.literal(doc)
          );
        }
        for (const prop of m.properties.values()) {
          const propNameNode = nn(nameForProperty(prop));
          writer.addQuad(propNameNode, nn("rdf:type"), nn("rdf:Property"));
          writer.addQuad(propNameNode, nn("rdfs:domain"), nameNode);

          if (prop.type.kind === "Model") {
            if (isArrayModelType(program, prop.type)) {
              // after years of research I have been unable to determine how
              // to create a subtype of seq with a particular element type
              writer.addQuad(propNameNode, nn("rdfs:range"), nn("rdf:Seq"));
            } else {
              writer.addQuad(
                propNameNode,
                nn("rdfs:range"),
                nn(nameForModel(prop.type))
              );
            }
          } else if (prop.type.kind === "Union") {
            for (const variant of prop.type.variants.values()) {
              if (variant.type.kind === "Model") {
                writer.addQuad(
                  propNameNode,
                  nn("rdfs:rangeIncludes"),
                  nn(nameForModel(variant.type))
                );
              } else if (
                variant.type.kind === "String" ||
                variant.type.kind === "Number"
              ) {
                writer.addQuad(
                  propNameNode,
                  nn("rdfs:rangeIncludes"),
                  DataFactory.literal(variant.type.value)
                );
              }
              // todo: support booleans and other exotic union types
            }
          }

          const doc = getDoc(program, prop);
          if (doc) {
            writer.addQuad(
              propNameNode,
              nn("rdfs:comment"),
              DataFactory.literal(doc)
            );
          }
        }
      },
    });

    writer.end((err, result) => {
      if (err) {
        throw err;
      }

      program.host.writeFile(
        path.join(program.compilerOptions.outputPath, "models.ttl"),
        result
      );
    });
  }

  function nameForModel(model: ModelType) {
    const intrinsic = getIntrinsicModelName(program, model);

    if (!intrinsic) {
      let ns = getNsForModel(model);
      return ns.prefix + ":" + model.name;
    }

    switch (intrinsic) {
      case "boolean":
        return "xsd:boolean";
      case "bytes":
        return "xsd:hexBinary"; // could be base64, check format?
      case "duration":
        return "xsd:dayTimeDuration";
      case "float":
        return "xsd:double"; // seems best for either float32 or float64?
      case "float32":
        return "xsd:float";
      case "float64":
        return "xsd:double";
      case "integer":
        return "xsd:integer";
      case "uint8":
        return "xsd:unsignedByte";
      case "uint16":
        return "xsd:unsignedShort";
      case "uint32":
        return "xsd:unsignedIntS";
      case "uint64":
        return "xsd:unsignedLong";
      case "int8":
        return "xsd:byte";
      case "int16":
        return "xsd:short";
      case "int32":
        return "xsd:int";
      case "int64":
        return "xsd:long";
      case "safeint":
        return "xsd:long";
      case "string":
        return "xsd:string";
      case "numeric":
        return "xsd:decimal";
      case "plainDate":
        return "xsd:date";
      case "plainTime":
        return "xsd:time";
      case "zonedDateTime":
        return "xsd:dateTime";
      default:
        throw new Error("xsd datatype not defined for instrinsic " + intrinsic);
    }
  }

  function nameForProperty(prop: ModelTypeProperty) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name;
  }

  function getNsForModel(type: ModelType) {
    let current: ModelType | NamespaceType | undefined = type;
    let nsData: RdfnsData | undefined;

    while (current && !nsData) {
      nsData = getRdfnsState(program).get(current);
      current = current.namespace;
    }

    if (!nsData) {
      nsData = { prefix: "ex", namespace: "http://example.org/" };
    }

    if (!prefixes.hasOwnProperty(nsData.prefix)) {
      writer.addPrefix(nsData.prefix, nsData.namespace);
      prefixes[nsData.prefix] = nsData.namespace;
    }

    return nsData;
  }
}

interface RdfnsData {
  prefix: string;
  namespace: string;
}

const rdfnsSymbol = Symbol.for("rdfns");
const rdfnsDef = createDecoratorDefinition({
  name: "@rdfns",
  target: ["Namespace", "Model"],
  args: [{ kind: "String" }, { kind: "String" }],
} as const);

function getRdfnsState(program: Program): Map<Type, RdfnsData> {
  return program.stateMap(rdfnsSymbol);
}

export function $rdfns(
  context: DecoratorContext,
  target: NamespaceType | ModelType,
  prefix: string,
  namespace: string
) {
  if (!rdfnsDef.validate(context, target, [prefix, namespace])) {
    return;
  }

  getRdfnsState(context.program).set(target, {
    prefix,
    namespace,
  });
}

export const namespace = "CadlRdf";
