import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { FileText, Download, FolderOpen, Plus, Folder, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSignedFileUrl } from "@/lib/storage";

interface ClassDocument {
  id: string;
  file_name: string;
  file_url: string;
  created_at: string;
  user_id: string;
  category_id: string | null;
  profiles?: {
    full_name: string;
  };
}

interface DocumentCategory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface ClassDocumentsProps {
  classId: string;
  isAdmin?: boolean;
}

export const ClassDocuments = ({ classId, isAdmin = false }: ClassDocumentsProps) => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<ClassDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDesc, setNewCategoryDesc] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("");
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchDocuments();
    subscribeToDocuments();
  }, [classId]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("document_categories")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setCategories(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const fetchDocuments = async () => {
    try {
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("id, file_url, file_name, created_at, user_id, category_id")
        .eq("class_id", classId)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      const { data: noticeData, error: noticeError } = await supabase
        .from("notice_board")
        .select("id, file_url, file_name, created_at, user_id, category_id")
        .eq("class_id", classId)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false });

      const allDocs = [...(messagesData || []), ...(noticeData || [])];
      
      if (allDocs.length > 0) {
        const userIds = [...new Set(allDocs.map(doc => doc.user_id))];
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        if (profileError) throw profileError;

        const profileMap = new Map(profiles?.map(p => [p.id, p]));
        const docsWithProfiles = allDocs.map(doc => ({
          ...doc,
          profiles: profileMap.get(doc.user_id) || { full_name: "Unknown" }
        }));

        setDocuments(docsWithProfiles as ClassDocument[]);
      } else {
        setDocuments([]);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const subscribeToDocuments = () => {
    const messagesChannel = supabase
      .channel(`messages_docs_${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    const noticeChannel = supabase
      .channel(`notice_docs_${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notice_board",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(noticeChannel);
    };
  };

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      // Get signed URL for secure access to private bucket files
      const signedUrl = await getSignedFileUrl(fileUrl);
      
      const response = await fetch(signedUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Document downloaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: error.message,
      });
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Category name is required",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("document_categories")
        .insert({
          class_id: classId,
          name: newCategoryName.trim(),
          description: newCategoryDesc.trim() || null,
          created_by: user.id,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Category created successfully",
      });

      setNewCategoryName("");
      setNewCategoryDesc("");
      setCreateCategoryOpen(false);
      fetchCategories();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleUploadDocument = async () => {
    if (!uploadFile) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a file to upload",
      });
      return;
    }

    if (!uploadCategory) {
      toast({
        variant: "destructive",
        title: "Error", 
        description: "Please select a category for the document",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = uploadFile.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${classId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('class-files')
        .upload(filePath, uploadFile);

      if (uploadError) throw uploadError;

      // Store the file path (not public URL) for later signed URL generation
      const { error: insertError } = await supabase
        .from("messages")
        .insert({
          class_id: classId,
          user_id: user.id,
          content: `Uploaded ${uploadFile.name}`,
          file_url: filePath, // Store path, not URL
          file_name: uploadFile.name,
          file_type: uploadFile.type,
          category_id: uploadCategory,
        });

      if (insertError) throw insertError;

      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });

      setUploadFile(null);
      setUploadCategory("");
      setUploadDocOpen(false);
      fetchDocuments();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message,
      });
    }
  };

  const filteredDocuments = selectedCategory
    ? documents.filter(doc => doc.category_id === selectedCategory)
    : documents.filter(doc => !doc.category_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Class Documents Library</h3>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Dialog open={createCategoryOpen} onOpenChange={setCreateCategoryOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  New Category
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Document Category</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="category-name">Category Name *</Label>
                    <Input
                      id="category-name"
                      placeholder="e.g., ML1, DL, Physics"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="category-desc">Description</Label>
                    <Textarea
                      id="category-desc"
                      placeholder="Optional description"
                      value={newCategoryDesc}
                      onChange={(e) => setNewCategoryDesc(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleCreateCategory} className="w-full">
                    Create Category
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={uploadDocOpen} onOpenChange={(open) => {
              setUploadDocOpen(open);
              if (!open) {
                setUploadFile(null);
                setUploadCategory("");
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Upload className="w-4 h-4 mr-1" />
                  Upload Document
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="upload-category">Select Category *</Label>
                    <Select value={uploadCategory} onValueChange={(value) => setUploadCategory(value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="upload-file">Select File *</Label>
                    <Input
                      id="upload-file"
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setUploadFile(file);
                        }
                      }}
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
                    />
                    {uploadFile && (
                      <p className="text-sm text-green-600 mt-1">✓ {uploadFile.name} selected</p>
                    )}
                  </div>
                  <Button 
                    onClick={handleUploadDocument} 
                    className="w-full"
                    disabled={!uploadFile || !uploadCategory}
                  >
                    Upload Document
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : categories.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FolderOpen className="w-20 h-20 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No Categories Yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto mb-4">
              {isAdmin 
                ? "Create categories to organize class documents by subject (ML1, DL, etc.)"
                : "Your class admin will create categories to organize documents"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              Uncategorized ({documents.filter(d => !d.category_id).length})
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={selectedCategory === cat.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.id)}
              >
                <Folder className="w-4 h-4 mr-1" />
                {cat.name} ({documents.filter(d => d.category_id === cat.id).length})
              </Button>
            ))}
          </div>

          {/* Documents List */}
          {filteredDocuments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <FileText className="w-12 h-12 mx-auto mb-2 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">
                  No documents in this category yet
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredDocuments.map((doc) => (
                <Card key={doc.id} className="hover:shadow-md transition-all hover:scale-[1.01]">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Shared by {doc.profiles?.full_name} • {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(doc.file_url, doc.file_name!)}
                        className="shrink-0"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
