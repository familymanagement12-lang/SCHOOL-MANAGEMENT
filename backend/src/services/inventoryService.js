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

module.exports = { normalizeInventoryItem };
