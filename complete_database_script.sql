-- ========================================================
-- NYUMBA SALAMA COMPLETE DATABASE & MIGRATION SCRIPT
-- ========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. RENTAL REQUESTS TABLE & POLICIES
CREATE TABLE IF NOT EXISTS public.rental_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    applicant_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rental_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own rental requests" ON public.rental_requests;
CREATE POLICY "Users can insert own rental requests" ON public.rental_requests
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own or property owners view applications" ON public.rental_requests;
CREATE POLICY "Users view own or property owners view applications" ON public.rental_requests
    FOR SELECT TO authenticated USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.properties p 
            WHERE p.id = rental_requests.property_id AND p.owner_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Owners or admins update rental request status" ON public.rental_requests;
CREATE POLICY "Owners or admins update rental request status" ON public.rental_requests
    FOR UPDATE TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.properties p 
            WHERE p.id = rental_requests.property_id AND p.owner_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
        )
    );

-- 2. MAINTENANCE REQUESTS TABLE & POLICIES
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    reported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users create maintenance requests" ON public.maintenance_requests;
CREATE POLICY "Users create maintenance requests" ON public.maintenance_requests
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = reported_by);

DROP POLICY IF EXISTS "Users view own maintenance requests" ON public.maintenance_requests;
CREATE POLICY "Users view own maintenance requests" ON public.maintenance_requests
    FOR SELECT TO authenticated USING (
        auth.uid() = reported_by OR
        EXISTS (
            SELECT 1 FROM public.properties p 
            WHERE p.id = maintenance_requests.property_id AND p.owner_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
        )
    );

-- 3. ROOMMATE POSTS TABLE & POLICIES
CREATE TABLE IF NOT EXISTS public.roommate_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    location TEXT NOT NULL,
    monthly_budget NUMERIC(14, 2) NOT NULL CHECK (monthly_budget > 0),
    preference TEXT,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.roommate_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public view active roommate posts" ON public.roommate_posts;
CREATE POLICY "Public view active roommate posts" ON public.roommate_posts
    FOR SELECT TO anon, authenticated USING (is_active = true OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create roommate posts" ON public.roommate_posts;
CREATE POLICY "Users create roommate posts" ON public.roommate_posts
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own roommate posts" ON public.roommate_posts;
CREATE POLICY "Users update own roommate posts" ON public.roommate_posts
    FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 4. DIGITAL CONTRACTS TABLE & POLICIES
CREATE TABLE IF NOT EXISTS public.digital_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    landlord_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_name TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.digital_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Landlords view and create own contract drafts" ON public.digital_contracts;
CREATE POLICY "Landlords view and create own contract drafts" ON public.digital_contracts
    FOR ALL TO authenticated USING (auth.uid() = landlord_id) WITH CHECK (auth.uid() = landlord_id);

-- 5. ADMIN ROLE REQUEST RPC FUNCTIONS
CREATE OR REPLACE FUNCTION public.ns_admin_fetch_role_requests_v2()
RETURNS TABLE (
    id UUID,
    user_id UUID,
    requested_role TEXT,
    reason TEXT,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    RETURN QUERY
    SELECT rr.id, rr.user_id, rr.requested_role, rr.reason, rr.status, rr.created_at
    FROM public.role_requests rr
    ORDER BY rr.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.ns_admin_review_role_request_v2(
    p_request_id UUID,
    p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid decision. Must be approved or rejected.';
    END IF;

    SELECT user_id, requested_role INTO v_user_id, v_role
    FROM public.role_requests
    WHERE id = p_request_id;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Role request not found');
    END IF;

    UPDATE public.role_requests
    SET status = p_decision
    WHERE id = p_request_id;

    IF p_decision = 'approved' THEN
        UPDATE public.profiles
        SET role = v_role
        WHERE id = v_user_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Role request ' || p_decision);
END;
$$;

-- 6. AUTOMATED NOTIFICATION TRIGGER
CREATE OR REPLACE FUNCTION public.handle_rental_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.notifications (user_id, title, message, is_read, created_at)
        VALUES (
            NEW.user_id,
            'Hali ya ombi imebadilika',
            'Ombi lako la kupanga nyumba limesbadilishwa kuwa: ' || NEW.status,
            false,
            now()
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_status_notification_trigger ON public.rental_requests;

CREATE TRIGGER rental_status_notification_trigger
    AFTER UPDATE ON public.rental_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_rental_status_change();