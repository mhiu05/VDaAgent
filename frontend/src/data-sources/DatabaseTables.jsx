import React, { useState } from "react";
import { ChevronDown, ChevronRight, Database, FileSpreadsheet } from "lucide-react";

export function DatabaseTables({ tables, selectedTable, setSelectedTable, selectedTables = [], setSelectedTables }) {
  const [expandedSchemas, setExpandedSchemas] = useState({});
  if (!tables.length) return null;
  const groupedTables = groupTablesBySchema(tables);
  const schemaNames = Object.keys(groupedTables);
  const selectedKeys = new Set(selectedTables.map(tableKey));

  function isSchemaExpanded(schemaName) {
    return expandedSchemas[schemaName] ?? true;
  }

  function toggleSchemaOpen(schemaName) {
    setExpandedSchemas((current) => ({
      ...current,
      [schemaName]: !isSchemaExpanded(schemaName),
    }));
  }

  function schemaSelectionState(schemaName) {
    const schemaTables = groupedTables[schemaName] || [];
    const selectedCount = schemaTables.filter((table) => selectedKeys.has(tableKey(normalizeTableSelection(table)))).length;
    return {
      selectedCount,
      totalCount: schemaTables.length,
      checked: selectedCount > 0 && selectedCount === schemaTables.length,
      partial: selectedCount > 0 && selectedCount < schemaTables.length,
    };
  }

  function toggleTable(table) {
    const normalized = normalizeTableSelection(table);
    const key = tableKey(normalized);
    const exists = selectedKeys.has(key);
    const next = exists
      ? selectedTables.filter((item) => tableKey(item) !== key)
      : [...selectedTables, normalized];
    setSelectedTables(next);
    setSelectedTable(next[0] || normalized);
  }

  function toggleSchemaSelection(schemaName) {
    const schemaTables = groupedTables[schemaName] || [];
    const state = schemaSelectionState(schemaName);
    const nextByKey = new Map(selectedTables.map((table) => [tableKey(table), table]));

    schemaTables.forEach((table) => {
      const normalized = normalizeTableSelection(table);
      const key = tableKey(normalized);
      if (state.checked) nextByKey.delete(key);
      else nextByKey.set(key, normalized);
    });

    const next = Array.from(nextByKey.values());
    setSelectedTables(next);
    setSelectedTable(next[0] || { schema_name: schemaName, table_name: "" });
  }

  return (
    <div className="table-picker ssms-tree-picker">
      <div className="table-picker-header">
        <strong>Database objects</strong>
        <span>{selectedTables.length} table(s) selected</span>
      </div>
      <div className="ssms-tree" role="tree" aria-label="Readable database tables">
        {schemaNames.map((schemaName) => {
          const schemaTables = groupedTables[schemaName] || [];
          const state = schemaSelectionState(schemaName);
          const expanded = isSchemaExpanded(schemaName);
          return (
            <div className="ssms-tree-schema" key={schemaName}>
              <div className="ssms-tree-node schema-node" role="treeitem" aria-expanded={expanded} title={`Schema ${schemaName}: ${state.selectedCount} of ${state.totalCount} tables selected.`}>
                <button type="button" className="tree-toggle" onClick={() => toggleSchemaOpen(schemaName)} aria-label={`${expanded ? "Collapse" : "Expand"} ${schemaName}`}>
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <input
                  type="checkbox"
                  checked={state.checked}
                  ref={(element) => {
                    if (element) element.indeterminate = state.partial;
                  }}
                  onChange={() => toggleSchemaSelection(schemaName)}
                />
                <Database size={15} />
                <span className="tree-label">
                  <strong>{schemaName}</strong>
                  <small>{state.selectedCount}/{state.totalCount} selected</small>
                </span>
              </div>
              {expanded && (
                <div className="ssms-tree-children" role="group">
                  {schemaTables.map((table) => {
                    const normalized = normalizeTableSelection(table);
                    const key = tableKey(normalized);
                    const isSelected = selectedKeys.has(key);
                    return (
                      <label className={`ssms-tree-node table-node ${isSelected ? "selected" : ""}`} key={key} role="treeitem" title={`Table ${normalized.schema_name}.${normalized.table_name}`}>
                        <span className="tree-indent" />
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTable(table)}
                        />
                        <FileSpreadsheet size={15} />
                        <span className="tree-label">
                          <strong>{normalized.table_name}</strong>
                          <small>{normalized.schema_name}.{normalized.table_name}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupTablesBySchema(tables) {
  return tables.reduce((groups, table) => {
    const normalized = normalizeTableSelection(table);
    const schemaName = normalized.schema_name || "default";
    return {
      ...groups,
      [schemaName]: [...(groups[schemaName] || []), table],
    };
  }, {});
}

function normalizeTableSelection(table) {
  return {
    schema_name: table.schema_name || table.schema || "",
    table_name: table.table_name || table.table || "",
  };
}

function tableKey(table) {
  return `${table.schema_name}.${table.table_name}`;
}
