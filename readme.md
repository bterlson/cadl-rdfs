# cadl-rdf

A prototype emitter for Cadl models to RDF in Turtle format. Uses vocabulary from rdf, rdfs, and schema.org.


## Usage

Add the following to your `cadl-project.yaml`:

```yaml
emitters:
  "cadl-rdf": true
```

Then, add `import "cadl-rdf"` to your Cadl program and add the `@rdfns` decorator on a namespace or individual models you want to generate RDF for. For example, if your `main.cadl` file contains

```
import "cadl-rdf";
using CadlRdf;

@rdfns("ex", "http://example.org/")
model Person {
  name: string;
}
```

will result in the `cadl-output/models.ttl` being generated like:

```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix ex: <http://example.org/>.

ex:Person rdf:type rdfs:Class.
ex:name rdf:type rdf:Property;
    rdfs:domain ex:Person;
    rdfs:range xsd:string.

```

See the sample directory for a larger example.