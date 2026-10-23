// NYUMBA SALAMA CLOUD BACKEND SERVICE (UPDATED)

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Maintenance Requests API
export async function createMaintenanceRequest(propertyId, category, description) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unapaswa kuingia akaunti kwanza.");

    const { data, error } = await supabase.from('maintenance_requests').insert({
        property_id: propertyId || null,
        reported_by: user.id,
        category,
        description
    }).select().single();

    if (error) throw error;
    return data;
}

export async function loadMyMaintenanceRequests() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('maintenance_requests')
        .select('*')
        .eq('reported_by', user.id)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

// Roommate Finder API
export async function createRoommatePost(fullName, location, monthlyBudget, preference, phone) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unapaswa kuingia akaunti kwanza.");

    const { data, error } = await supabase.from('roommate_posts').insert({
        user_id: user.id,
        full_name: fullName,
        location,
        monthly_budget: monthlyBudget,
        preference,
        phone
    }).select().single();

    if (error) throw error;
    return data;
}

export async function loadRoommatePosts() {
    const { data, error } = await supabase
        .from('roommate_posts')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

// Digital Contracts API
export async function createContractDraft(propertyId, tenantName, body) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unapaswa kuingia akaunti kwanza.");

    const { data, error } = await supabase.from('digital_contracts').insert({
        property_id: propertyId || null,
        landlord_id: user.id,
        tenant_name: tenantName,
        body
    }).select().single();

    if (error) throw error;
    return data;
}

export async function loadMyContractDrafts() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('digital_contracts')
        .select('*')
        .eq('landlord_id', user.id)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}