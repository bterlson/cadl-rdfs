import { Writer, DataFactory, Quad, BaseQuad, Variable, Literal, Store } from "n3";
import path from "path";
const nn = DataFactory.namedNode;

import {
  createDecoratorDefinition,
  DecoratorContext,
  Model,
  Namespace,
  Program,
  navigateProgram,
  Type,
  ModelProperty,
  getIntrinsicModelName,
  getDoc,
  isArrayModelType,
  createCadlLibrary,
} from "@cadl-lang/compiler";

const lib = createCadlLibrary({
  name: "cadl-rdf",
  diagnostics: {}, // no diagnostics yet
  emitter: {} // no emitter options
});

export function $onEmit(program: Program) {
  const emitter = createRdfEmitter(program);
  emitter.emit();
}

function createRdfEmitter(program: Program) {
  const prefixes: Record<string, string> = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    skos: "http://www.w3.org/2004/02/skos/core#",
    owl: "http://www.w3.org/2002/07/owl#http",
    sh: "http://www.w3.org/ns/shacl#"
  };

  const writer_generic =  new Writer({ prefixes });
  const writer_classes = new Writer({ prefixes });
  const writer_props = new Writer({ prefixes });
  const writer_constraints= new Writer({ prefixes });

  return {
    emit,
  };

  function emit() 
  {

    navigateProgram(program, 
      {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }

        //CLASS PART

        const nameNode = nn(nameForModel(m));

        writer_classes.addQuad(nameNode, nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn("owl:Class"));
        writer_classes.addQuad(nameNode, nn("rdfs:label"), DataFactory.literal(m.name));

        if (m.baseModel) {
          writer_classes.addQuad(
            nameNode, 
            nn("rdfs:subclassOf"),
            nn(nameForModel(m.baseModel))
          );
        }

        const doc = getDoc(program, m);
        if (doc) {
          writer_classes.addQuad(
            nameNode,
            nn("skos:note"),
            DataFactory.literal(doc)
          );
        }

        //PROP PART & SHACL part

        const nameNodeShacl = nn(nameForModelSHACL(m));
        writer_constraints.addQuad(nameNodeShacl, nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn("sh:NodeShape"));
        writer_constraints.addQuad(nameNodeShacl, nn("rdfs:label"), DataFactory.literal("Shape for " + m.name));
        writer_constraints.addQuad(nameNodeShacl, nn("sh:targetClass"), nn(nameForModel(m)));


        for (const prop of m.properties.values()) 
        {
          const propNameNode = nn(nameForProperty(prop));

          if (prop.type.kind === "Model") 
          {

              // PROPERTIES
              if (!checkIfDataProperty(prop.type))
              {
                writer_props.addQuad(propNameNode, nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn("owl:ObjectProperty"));
              }
              else{
                writer_props.addQuad(propNameNode, nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn("owl:DatatypeProperty"));
              }

              writer_props.addQuad(propNameNode, nn("rdfs:label"), DataFactory.literal(prop.name));
              writer_props.addQuad
              (
                propNameNode,
                nn("rdfs:range"),
                nn(nameForModel(prop.type))
              );

              // SHACL
              writer_constraints.addQuad(DataFactory.quad(
                nameNodeShacl,
                nn("sh:property"),
                writer_constraints.blank
                ([{
                  predicate: nn("sh:path"),
                  object:    propNameNode,
                },{
                  predicate: nn("sh:datatype"),
                  object:    nn(nameForModel(prop.type)),
                }])
              ));


          }

          else if (prop.type.kind === "Union") 
          {

            // PROPERTIES

            writer_props.addQuad(propNameNode, nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn("owl:DatatypeProperty"));
            writer_props.addQuad(propNameNode, nn("rdfs:label"), DataFactory.literal(prop.name));

            //SHACL

            const arr= [];

            for (const variant of prop.type.variants.values()) 
            {
              if (variant.type.kind === "Model") 
              {
                arr.push(DataFactory.literal(nameForModel(variant.type)));
              
              }
              if (variant.type.kind === "String" || variant.type.kind === "Number") 
              {
                arr.push(DataFactory.literal(variant.type.value)); 
              }

            }

            if (arr.length == 1)
            {
              writer_constraints.addQuad(DataFactory.quad(
                nameNodeShacl,
                  nn("sh:property"),
                  writer_constraints.blank([{
                   predicate: nn("sh:path"),
                    object:    propNameNode,
                  },{
                    predicate: nn("sh:datatype"),
                    object:    arr[0],
                  }])
                ));
            }
            else
            {
              writer_constraints.addQuad(nameNodeShacl, nn("sh:path"), propNameNode);
              writer_constraints.addQuad(nameNodeShacl, nn("sh:in"), writer_constraints.list(arr));
            }

            
          }

          const doc = getDoc(program, prop);
          if (doc) {
            writer_props.addQuad(
              propNameNode,
              nn("skos:note"),
              DataFactory.literal(doc)
            );

          }
        }
      },
    });


    writer_classes.end((err, result)=> 
    {
      if (err) {
        throw err;
      }
      
      writer_props.end((err, result1) => 
      {
          if (err) {
            throw err;
          }

          writer_constraints.end((err, result2) => 
          {
              if (err) {
                throw err;
              }
          
              program.host.writeFile(
                path.join(program.compilerOptions.outputPath!, "models.ttl"),
                result + result1 + result2
              );
          })
      })
    });
    
  }

  function checkIfDataProperty(model: Model) {
    return getIntrinsicModelName(program, model) !== undefined;
  }

  function nameForModel(model: Model) {
    const intrinsic = getIntrinsicModelName(program, model);

    if (!intrinsic) {

      let ns = getNsForModel(model);

      if (model.name === "Array")
      {
        if (model.templateArguments != undefined)
        {
          return ns.prefix + ":" + ((<any>model.templateArguments[0]).name);
        }
      }
      else{
        return ns.prefix + ":" + model.name;
      }
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

  function nameForModelSHACL(model: Model)
  {
    return nameForModel(model) + "_NodeShape";
  }

  function nameForProperty(prop: ModelProperty) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name;
  }

  function getNsForModel(type: Model) 
  {
    let current: Model | Namespace | undefined = type;
    let nsData: RdfnsData | undefined;

    while (current && !nsData) {
      nsData = getRdfnsState(program).get(current);
      current = current.namespace;
    }

    if (!nsData) {
      nsData = { prefix: "ex", namespace: "http://example.org/" };
    }

    if (!prefixes.hasOwnProperty(nsData.prefix))
    {
      writer_generic.addPrefix(nsData.prefix, nsData.namespace);
      prefixes[nsData.prefix] = nsData.namespace;
    }

    return nsData;
  }
}



interface RdfnsData {
  prefix: string;
  namespace: string;
}

const rdfnsSymbol = lib.createStateSymbol("rdfns");
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
  target: Namespace | Model,
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