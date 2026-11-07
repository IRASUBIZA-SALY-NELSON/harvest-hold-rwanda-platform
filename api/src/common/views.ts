/** Turns database rows into the JSON shapes the app uses. */

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export function userView(u: any) {
  return {
    id: u.id,
    photoId: u.photo_id ?? null,
    role: u.role,
    name: u.name,
    phone: u.phone,
    district: u.district,
    createdAt: iso(u.created_at),
    lang: u.lang,
    ...(u.role === 'farmer' ? { coldRoomId: u.cold_room_id } : { businessName: u.business_name, businessType: u.business_type }),
  };
}

export function batchView(b: any) {
  return {
    id: b.id,
    farmerId: b.farmer_id,
    coldRoomId: b.cold_room_id,
    crop: b.crop,
    quantity: b.quantity,
    unit: b.unit,
    storedAt: iso(b.stored_at),
    status: b.status,
    /** The batch's number on the label and in the QR code. */
    code: b.code,
    harvestDate: (b.harvest_date as string | null) ?? null,
    storageLocation: b.storage_location ?? '',
    initialQuantity: b.initial_quantity ?? b.quantity,
    /** What the farmer asked to store, when it differs from what the operator confirmed. */
    requestedQuantity: b.requested_quantity ?? null,
    inspectionNote: b.inspection_note ?? '',
    cooperativeId: b.cooperative_id ?? null,
    registeredBy: b.registered_by_name ?? null,
    removedAt: iso(b.removed_at),
    collectionRequestedAt: iso(b.collection_requested_at),
    /** Where the produce stands: in the room, asked to be collected, or gone. */
    collectionStatus: (b.status === 'removed' ? 'collected' : b.collection_requested_at ? 'requested' : 'stored') as 'stored' | 'requested' | 'collected',
  };
}

export function listingView(l: any) {
  return {
    id: l.id,
    batchId: l.batch_id,
    farmerId: l.farmer_id,
    coldRoomId: l.cold_room_id,
    crop: l.crop,
    quantity: l.quantity,
    unit: l.unit,
    pricePerUnit: l.price_per_unit,
    status: l.status,
    createdAt: iso(l.created_at),
  };
}

export function orderView(o: any) {
  return {
    id: o.id,
    listingId: o.listing_id,
    buyerId: o.buyer_id,
    farmerId: o.farmer_id,
    crop: o.crop,
    quantity: o.quantity,
    unit: o.unit,
    pricePerUnit: o.price_per_unit,
    note: o.note,
    status: o.status,
    createdAt: iso(o.created_at),
    updatedAt: iso(o.updated_at),
  };
}

export function alertView(a: any) {
  return { id: a.id, userId: a.user_id, type: a.type, params: a.params, link: a.link ?? undefined, read: a.read, createdAt: iso(a.created_at) };
}
