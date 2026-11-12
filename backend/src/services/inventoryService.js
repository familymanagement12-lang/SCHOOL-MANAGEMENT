const normalizeInventoryItem = (input = {}) => {
  const itemName = typeof input.item_name === 'string' ? input.item_name.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const quantity = Number(input.quantity);
  const assignedTo = input.assigned_to === '' || input.assigned_to === null || input.assigned_to === undefined
    ? null
    : Number(input.assigned_to);

  if (!itemName || itemName.length > 120) {
    return { error: 'Item name is required and must be 120 characters or fewer.' };
  }
  if (!category || category.length > 80) {
    return { error: 'Category is required and must be 80 characters or fewer.' };
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    return { error: 'Quantity must be a whole number greater than or equal to zero.' };
  }
  if (description.length > 500) {
    return { error: 'Description must be 500 characters or fewer.' };
  }
  if (assignedTo !== null && (!Number.isSafeInteger(assignedTo) || assignedTo < 1)) {
    return { error: 'Choose a valid staff member or leave the item unassigned.' };
  }

  return {
    value: {
      item_name: itemName,
      category,
      quantity,
      assigned_to: assignedTo,
      description: description || null,
    },
  };
};

const normalizeInventoryCatalogueItem = (input = {}) => {
  const legacy = normalizeInventoryItem(input);
  if (legacy.error) return legacy;

  const itemCode = typeof input.item_code === 'string' ? input.item_code.trim() : '';
  const barcode = typeof input.barcode === 'string' ? input.barcode.trim() : '';
  const itemType = input.item_type || 'consumable';
  const unit = typeof input.unit === 'string' ? input.unit.trim() : 'piece';
  const minimumStock = Number(input.minimum_stock ?? 0);
  const purchasePrice = Number(input.purchase_price ?? 0);
  const supplierId = input.supplier_id === '' || input.supplier_id === null || input.supplier_id === undefined
    ? null
    : Number(input.supplier_id);
  const storageLocation = typeof input.storage_location === 'string' ? input.storage_location.trim() : '';
  const itemStatus = input.item_status || 'active';
  const expiryDate = input.expiry_date || null;

  if (itemCode.length > 80 || barcode.length > 120) {
    return { error: 'Item code must be 80 characters or fewer and barcode 120 characters or fewer.' };
  }
  if (!['consumable', 'asset'].includes(itemType)) {
    return { error: 'Item type must be consumable or asset.' };
  }
  if (!unit || unit.length > 40) {
    return { error: 'Unit of measurement is required and must be 40 characters or fewer.' };
  }
  if (!Number.isSafeInteger(minimumStock) || minimumStock < 0) {
    return { error: 'Minimum stock must be a whole number greater than or equal to zero.' };
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0 || purchasePrice > 9999999999.99) {
    return { error: 'Purchase price must be a non-negative amount.' };
  }
  if (supplierId !== null && (!Number.isSafeInteger(supplierId) || supplierId < 1)) {
    return { error: 'Choose a valid supplier or leave the supplier unassigned.' };
  }
  if (storageLocation.length > 120) {
    return { error: 'Storage location must be 120 characters or fewer.' };
  }
  if (!['active', 'discontinued', 'archived'].includes(itemStatus)) {
    return { error: 'Select a valid item status.' };
  }
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return { error: 'Expiry date must be a valid calendar date in YYYY-MM-DD format.' };
  }

  return {
    value: {
      ...legacy.value,
      item_code: itemCode || null,
      barcode: barcode || null,
      item_type: itemType,
      unit,
      minimum_stock: minimumStock,
      purchase_price: purchasePrice,
      supplier_id: supplierId,
      storage_location: storageLocation || null,
      item_status: itemStatus,
      expiry_date: expiryDate,
    },
  };
};

module.exports = { normalizeInventoryItem, normalizeInventoryCatalogueItem };
