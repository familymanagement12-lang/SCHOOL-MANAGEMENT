import { useEffect, useState } from 'react';
import { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem } from '../api/inventory';
import { getUsers } from '../api/users';

function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    item_name: '',
    category: 'Classroom Items',
    quantity: '',
    assigned_to: '',
    description: ''
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    user = null;
  }
  const canManageInventory = ['admin', 'inventory', 'store'].includes(user?.role);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invRes, usersRes] = await Promise.all([
        getInventory(),
        canManageInventory ? getUsers() : Promise.resolve({ data: [] })
      ]);
      setInventory(invRes.data);
      if (canManageInventory) {
        setTeachers(usersRes.data.filter(u => u.role !== 'student' && u.is_active !== false));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      item_name: item.item_name,
      category: item.category,
      quantity: item.quantity,
      assigned_to: item.assigned_to || '',
      description: item.description || ''
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData({ item_name: '', category: 'Classroom Items', quantity: '', assigned_to: '', description: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editingId) {
        await updateInventoryItem(editingId, formData);
      } else {
        await createInventoryItem(formData);
      }
      handleCancelEdit();
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save inventory item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this inventory item?')) return;
    setError('');
    try {
      await deleteInventoryItem(id);
      if (editingId === id) handleCancelEdit();
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete item');
    }
  };

  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
      || (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()))
      || (item.assigned_to_name && item.assigned_to_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter === '' || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (loading) return <div className="page"><p>Loading...</p></div>;

  // Calculate Inventory Statistics
  const totalTypes = inventory.length;
  const totalUnits = inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const lowStock = inventory.filter(item => Number(item.quantity) > 0 && Number(item.quantity) <= 5).length;
  const outOfStock = inventory.filter(item => Number(item.quantity) === 0).length;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{
          background: 'linear-gradient(135deg, #f59e0b 0%, #e11d48 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          border: 'none',
          boxShadow: '0 10px 25px -5px rgba(225, 29, 72, 0.25)'
        }}>
          <div>
            <p className="eyebrow" style={{ color: '#fef3c7', fontWeight: '600' }}>Asset Management</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Inventory</h1>
            <p style={{ 
              color: '#ffffff', 
              fontSize: '1.05rem', 
              background: 'rgba(255, 255, 255, 0.15)', 
              padding: '0.75rem 1.25rem', 
              borderRadius: '8px', 
              display: 'inline-block', 
              marginTop: '0.5rem',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              lineHeight: '1.5'
            }}>
              {canManageInventory ? 'Track school property, equipment, and store supplies. Assign items to staff for accountability.' : 'View school assets assigned to you.'}
            </p>
          </div>
        </section>

        {error && <div className="error" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}

        <section className="module-stats">
          <div className="mini-stat"><span>Item Types</span><strong style={{ color: '#3b82f6' }}>{totalTypes}</strong></div>
          <div className="mini-stat"><span>Total Units</span><strong style={{ color: '#10b981' }}>{totalUnits}</strong></div>
          <div className="mini-stat"><span>Low Stock (≤ 5)</span><strong style={{ color: lowStock > 0 ? '#f59e0b' : '#64748b' }}>{lowStock}</strong></div>
          <div className="mini-stat"><span>Out of Stock</span><strong style={{ color: outOfStock > 0 ? '#ef4444' : '#64748b' }}>{outOfStock}</strong></div>
        </section>

        <section className="split-layout">
          {canManageInventory && (
            <form className="data-panel form-panel" onSubmit={handleSubmit}>
              <div className="panel-heading">
                <div><p className="eyebrow">{editingId ? 'Edit Asset' : 'New Asset'}</p><h2>{editingId ? 'Update Item' : 'Add to Inventory'}</h2></div>
              </div>
              <label>Item Name *</label>
              <input type="text" maxLength="120" value={formData.item_name} onChange={(e) => setFormData({...formData, item_name: e.target.value})} placeholder="e.g. HP Laptop" required />
              <label>Category *</label>
              <select value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} required>
                <option value="Classroom Items">Classroom Items</option>
                <option value="Office Items">Office Items</option>
                <option value="School Store">School Store</option>
                <option value="Other">Other</option>
              </select>
              <label>Quantity *</label>
              <input type="number" min="0" step="1" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: e.target.value})} required />
              <label>Assigned To (Staff)</label>
              <select value={formData.assigned_to} onChange={(e) => setFormData({...formData, assigned_to: e.target.value})}>
                <option value="">-- Unassigned --</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
              </select>
              <label>Description</label>
              <input type="text" maxLength="500" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Serial number, condition, etc." />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Item'}</button>
                {editingId && <button type="button" className="btn-secondary" onClick={handleCancelEdit}>Cancel</button>}
              </div>
            </form>
          )}

          <section className="data-panel" style={{ flex: canManageInventory ? '2' : '1' }}>
            <div className="panel-heading"><div><p className="eyebrow">Directory</p><h2>Asset List</h2></div></div>
            
            <div className="toolbar">
              <input type="search" placeholder="Search items or descriptions..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All Categories</option>
                <option value="Classroom Items">Classroom Items</option>
                <option value="Office Items">Office Items</option>
                <option value="School Store">School Store</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Qty</th>
                    {canManageInventory && <th>Assigned To</th>}
                    {canManageInventory && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map(item => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.item_name}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.description}</div>
                      </td>
                      <td><span className="status-pill present">{item.category}</span></td>
                      <td><strong>{item.quantity}</strong></td>
                      {canManageInventory && <td style={{ fontSize: '0.85rem' }}>{item.assigned_to_name || '-'}</td>}
                      {canManageInventory && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn-small btn-edit" type="button" onClick={() => handleEdit(item)}>Edit</button>
                          <button className="btn-small btn-delete" type="button" onClick={() => handleDelete(item.id)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredInventory.length === 0 && <p className="empty-state">No items found matching your criteria.</p>}
          </section>
        </section>
      </div>
    </div>
  );
}

export default Inventory;
