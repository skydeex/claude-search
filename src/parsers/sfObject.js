import { XMLParser } from 'fast-xml-parser';
import path from 'path';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) => ['value', 'fields', 'validationRules'].includes(tagName),
});

function parse(xml) {
  return parser.parse(xml);
}

// ── Field file: ObjectName__c/fields/FieldName__c.field-meta.xml ──────────

export function parseFieldFile(content, filePath) {
  const doc = parse(content);
  const f = doc.CustomField;
  if (!f) return null;

  const field = {
    apiName:          f.fullName ?? path.basename(filePath, '.field-meta.xml'),
    label:            str(f.label),
    type:             str(f.type),
    required:         bool(f.required),
    unique:           bool(f.unique),
    externalId:       bool(f.externalId),
    referenceTo:      str(f.referenceTo),
    relationshipName: str(f.relationshipName),
    description:      str(f.description),
    picklistValues:   [],
  };

  // Picklist values (valueSet > valueSetDefinition > value[])
  const vs = f.valueSet?.valueSetDefinition?.value;
  if (Array.isArray(vs)) {
    field.picklistValues = vs.map(v => ({
      value:     str(v.fullName) ?? str(v.label),
      label:     str(v.label),
      isDefault: bool(v.default),
      // FIX 7: v.isActive is a string 'true'/'false' from XML, not a JS boolean
      active:    v.isActive == null ? true : bool(v.isActive),
    }));
  }
  // Also support globalValueSet values inline
  const gvs = f.valueSet?.globalValueSet;
  if (gvs && !field.picklistValues.length) {
    // global value set — values defined elsewhere, just note the reference
    field.globalValueSet = str(gvs);
  }

  return field;
}

// ── Object meta file: ObjectName__c.object-meta.xml ───────────────────────

export function parseObjectFile(content, filePath) {
  const doc = parse(content);
  const o = doc.CustomObject;
  if (!o) return null;

  // Derive API name from the directory (parent folder of the file)
  const apiName = path.basename(path.dirname(filePath));

  return {
    apiName,
    label:       str(o.label),
    pluralLabel: str(o.pluralLabel),
    description: str(o.description),
  };
}

// ── Validation rule file: ObjectName__c/validationRules/RuleName.validationRule-meta.xml ──

export function parseValidationRuleFile(content, filePath) {
  const doc = parse(content);
  const vr = doc.ValidationRule;
  if (!vr) return null;

  return {
    fullName:       str(vr.fullName) ?? path.basename(filePath, '.validationRule-meta.xml'),
    active:         bool(vr.active),
    description:    str(vr.description),
    errorCondition: str(vr.errorConditionFormula),
    errorMessage:   str(vr.errorMessage),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function str(v) {
  if (v === undefined || v === null) return null;
  return String(v).trim() || null;
}

function bool(v) {
  if (v === undefined || v === null) return false;
  return String(v).toLowerCase() === 'true';
}
